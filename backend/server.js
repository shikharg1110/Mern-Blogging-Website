import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import bcrypt from 'bcrypt';
import {nanoid} from 'nanoid';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import admin from 'firebase-admin';
import serviceAccountKey from './serviceAccountKey.json' assert {type: "json"};
import {getAuth} from 'firebase-admin/auth';
import aws from 'aws-sdk';


// Schema below
import User from './Schema/User.js';
import Blog from './Schema/Blog.js';
import Notification from './Schema/Notification.js';
import Comment from './Schema/Comment.js';

const server = express();
let PORT = 3000;

// Using firebase admin SDK for authentication
admin.initializeApp({
    credential: admin.credential.cert(serviceAccountKey)
});

let emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/; // regex for email 
let passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/; // regex for password

server.use(express.json());

// backend -> 3000 and frontend -> 5172 are on different domains and port numbers
server.use(cors());

mongoose.connect(process.env.MY_DB_LOCATION, {
    autoIndex: true,
})
.then(() => {
    console.log("Connected to database");
})
.catch((err) => {
    console.log("Error occured while connecting to database: " + err.message);
});

// Setting up s3 bucket
// This create s3 aws client which is used to access the bucket for some methods which is assign to the user
const s3 = new aws.S3( {
    region: "ap-south-1",
    accessKeyId: process.env.MY_AWS_ACCESS_KEY,
    secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY
})
//Generate a url for sending data from frontend to aws bucket
const generateUploadURL = async () => {
    const date = new Date();
    const imageName = `${nanoid()}-${date.getTime()}.jpeg`;

    // it is predefined s3 promise to generate URL
    return await s3.getSignedUrlPromise( 'putObject', {
        Bucket: "mern-blogging-website-bucket",
        Key: imageName,
        Expires: 1000,
        ContentType: "image/jpeg",
    })
}


// Middleware to check the user is authenticated user using Acess_token
const verifyJWT = (req, res, next) => {

    // this authorization Header contain "bearer token" first a string bearer and then token so split it and taken the second element
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(" ")[1];

    if(token == null) {
        return res.status(401).json( {
            error: "No access token"
        })
    }

    jwt.verify(token, process.env.MY_SECRET_ACCESS_KEY, (err, user) => {
        if(err) {
            return res.status(403).json( {
                error: "Access token is invalid"
            })
        }
        req.user = user.id;
        next();
    })
}

// format to send to frontend
const formatDatatoSend = (user) => {

    // Access token is generated using jwt and send to frontend for authentication
    const access_token = jwt.sign({id: user._id}, process.env.MY_SECRET_ACCESS_KEY);

    return {
        access_token,
        profile_img: user.personal_info.profile_img,
        username: user.personal_info.username,
        fullname: user.personal_info.fullname,
    }
}

// Generate Unique username
// shik@gmail.com and shik@yahoo.com has same username -> shik
const generateUsername = async(email) => {
    // username is the email before the @
    let username = email.split("@")[0];
    let isUsernameNotUnique = await User.exists({
        "personal_info.username": username
    });

    isUsernameNotUnique ? username += nanoid().substring(0,5) : "";
    return username;
}
   

// Upload image url route in aws s3
server.get("/get-upload-url", (req, res)=> {
    generateUploadURL()
    .then(url => res.status(200).json({ uploadURL: url }))
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({
            error: err.message
        })
    })
    // after going to this path it will generate a URL which will send data from frontend to s3 bucket
})

server.post("/signup", (req, res) => {  
    let {fullname, email, password} = req.body;
    
    // validating the data from frontend
    if(fullname.length < 3) {
        return res.status(403).json({
            "error": "Fullname must be at least 3 characters long"
        });
    }
    if(!email.length) {
        return res.status(403).json({
            "error": "Email must be entered"
        });
    }
    if(!emailRegex.test(email)) {
        return res.status(403).json({
            "error": "Invalid email"
        });
    }
    if(!passwordRegex.test(password)) {
        return res.status(403).json({
            "error": "Password must contain 6 to 20 characters long, contain at least 1 uppercase letter, 1 lowercase letter, and 1 number"
        });
    }

    // To hash the password
    bcrypt.hash(password, 10, async(err, hashedPassword) => {
        let username = await generateUsername(email);
        let user = new User( {
            personal_info: { fullname, email, password: hashedPassword, username}
        })

        user.save()
        .then((u)=> {
            return res.status(200).json(formatDatatoSend(u))
        })
        .catch((err) => {

            if(err.code === 11000) {
                return res.status(500).json({
                    "error": "Email already exists"
                });
            }
                return res.status(500).json({
                    "error": err.message
                });
            });
        console.log(hashedPassword);
    });
});

server.post("/signin", (req, res) => {
    let {email, password} = req.body;

    // finding the user with the email
    User.findOne({ "personal_info.email": email })
    .then((user) => {
        if(!user) {
            return res.status(403).json({ "error": "Email not found" });
        }

        // compare the password only when google auth is false
        if(!user.google_auth) {
            
            // comparing the password
            bcrypt.compare(password, user.personal_info.password , (err, result) => {
                if(err) {
                    return res.status(403).json({"error": "Error occured while login try again"});
                }
                
                if(!result) {
                    return res.status(403).json({"error": "Incorrect Password"});
                }
                else {
                    return res.status(200).json(formatDatatoSend(user));
                }

            });
        }
        else {
            return res.status(403).json({"error": "Account was signed in with google. Try logging in using google account"})}
        }
    )
    .catch(err => {
        console.log(err);
        return res.status(500).json({ "error": err.message });
    })
})

// Google authorization frontend data received from path "/google-auth"
server.post("/google-auth", async(req, res) => {
    // Google Access token is sent from frontend for verification
    // after verification it store the user in db and hence async is used
    let { access_token } = req.body;

    getAuth()
    .verifyIdToken(access_token)
    .then(async (decodedUser) => {
        let {email, name, picture} = decodedUser;

        // replace the low resolution image with high resolution image
        picture = picture.replace("s96-c", "s384-c");

        // check if the user already exists
        let user = await User.findOne({"personal_info.email": email}).select("personal_info.fullname personal_info.username personal_info.profile_img google_auth")
        .then((u) => {
            return u || null;
        })
        .catch((err) => {
            return res.status(500).json({ "error": err.message });
        });

        // if user exist then send error message
        if(user) { // login
            if(!user.google_auth) {
                return res.status(403).json({"error": "This email was signed up without google. Please log in with password to access the account"});
            }
        }
        else { // sign up
            let username = await generateUsername(email);

            // data its get from google
            user = new User({
                personal_info: {
                    fullname: name,
                    email,
                    profile_img: picture,
                    username
                },
                google_auth: true
            });
            
            await user.save().then((u) => {
                // because we have to again check if the user is saved or not or user is null or not

                // here it directly make saved DB data to user
                user = u;
            })
            .catch((err) => {
                return res.status(500).json({ "error": err.message });
            })

        }

        return res.status(200).json(formatDatatoSend(user));

    })
    .catch((err) => {
        return res.status(500).json({ "error": "Failed to authenticate you with google. Try with some other google account" });
    })
})

server.post('/latest-blogs', (req, res) => {

    let {page} = req.body;

    let maxLimit = 5;
    

    Blog.find({ draft: false })
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
    .sort({ "publishedAt": -1 })
    .select("blog_id title des banner activity tags publishedAt -_id")
    .skip((page-1) * maxLimit)
    .limit(maxLimit)
    .then(blogs => {
        return res.status(200).json({ blogs })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.post("/all-latest-blogs-count", (req, res) => {
    Blog.countDocuments({draft: false})
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({error: err.message})
    })
})

server.get('/trending-blogs', (req, res) => {
    
    Blog.find({ draft: false })
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
    .sort({"activity.total_read": -1, "activity.total_likes": -1, "publishedAt": -1})
    .select("blog_id title publishedAt -_id")
    .limit(5)
    .then(blogs => {
        return res.status(200).json({blogs})
    })
    .catch(err => {
        return res.status(500).json({
            error: err.message
        })
    })
})

server.post("/search-blogs", (req, res) => {
    let { tag, query, author, page, limit, eliminate_blog } = req.body;

    let findQuery;
    
    if(tag) {
        findQuery = { tags: tag, draft: false, blog_id: { $ne: eliminate_blog} };
    }
    else if(query) {
        findQuery = { draft: false, title: new RegExp(query, 'i') }
    }
    else if( author) {
        findQuery = { author, draft: false}
    }

    let maxLimit = limit ? limit : 2;

    Blog.find(findQuery)
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname -_id")
    .sort({ "publishedAt": -1 })
    .select("blog_id title des banner activity tags publishedAt -_id")
    .skip((page-1) *maxLimit)
    .limit(maxLimit)
    .then(blogs => {
        return res.status(200).json({ blogs })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })
})

server.post("/search-blogs-count", (req, res) => {
    let {tag, author, query} = req.body;

    let findQuery;
    
    if(tag) {
        findQuery = { tags: tag, draft: false };
    }
    else if(query) {
        findQuery = { draft: false, title: new RegExp(query, 'i') }
    }else if( author) {
        findQuery = { author, draft: false}
    }

    Blog.countDocuments(findQuery)
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.log(err.message);
        return res.status(500).json({error: err.message})
    }) 
})

// for searching the user
server.post("/search-users", (req, res) => {
    let { query } = req.body;
    User.find({"personal_info.username": new RegExp(query, 'i')})
    .limit(50)
    .select("personal_info.fullname personal_info.username personal_info.profile_img -_id")
    .then(users => {
        return res.status(200).json({users})
    })
    .catch(err => {
        return res.status(500).json({ error: err.message})
    })
})

server.post("/get-profile", (req, res) => {
    let {username} = req.body;

    User.findOne({"personal_info.username": username})
    .select("-personal_info.password -google_auth -updatedAt -blogs")
    .then(user => {
        return res.status(200).json(user)
    })
    .catch(err => {
        console.log(err);
        return res.status(500).json({error: err.message})
    })
})

// create post is the method where user can crete post
// but it should be an authenticate user which is verified by Middleware using access_token
server.post('/create-blog', verifyJWT, (req, res) => {
    let authorId = req.user;
    let { title, des, banner, tags, content, draft, id } = req.body;

    // validate
    if(!title.length) {
        return res.status(403).json( {
            error: "You must provide a title"
        });
    }

    // validate if draft==false
    if(!draft) {

        if(!des.length || des.length > 200) {
            return res.status(403).json( {
                error: "You must provide blog description under 200 characters"
            });
        }
    
        if(!banner.length) {
            return res.status(403).json( {
                error: "You must provide blog banner to publish it"
            });
        }
    
        if(!content.blocks.length) {
            return res.status(403).json( {
                error: "There must be some blog content to publish it"
            });
        }
    
        if(!tags.length || tags.length > 10) {
            return res.status(403).json( {
                error: "Provide tags in order to publish the blog, Maximum is 10"
            });
        }

    }


    // 'Tech' tag is not different then 'tech' tag
    tags = tags.map(tag => tag.toLowerCase());

    let blog_id = id || title.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, "-").trim() + nanoid();

    if(id) {
        Blog.findOneAndUpdate({ blog_id }, { title, des, banner, content, tags, draft: draft ? draft : false})
        .then(() => {
            return res.status(200).json({id: blog_id});
        })
        .catch(err => {
            return res.status(500).json({error: err.message});
        })
    }

    else {

        // new blog instance is made
        let blog = new Blog( {
            title, des, banner, content, tags, author: authorId, blog_id, draft: Boolean(draft)
        })
    
        // mongodb save the blog
        blog.save().then((blog) => {
            let incrementVal = draft ? 0 : 1;
    
            User.findOneAndUpdate(
                { _id: authorId}, 
                { $inc: { "account_info.total_posts" : incrementVal },
                $push: { "blogs": blog._id }
            })
            .then(user => {
                return res.status(200).json( {
                    id: blog.blog_id
                })
            })
            .catch(err => {
                return res.status(500).json({
                    error: "Failed to update total posts number"
                })
            })
        })
        .catch(err => {
            return res.status(500).json({
                error: err.message
            })
        })
    }

})

server.post("/get-blog", (req, res) => {
    let { blog_id, draft, mode } = req.body;
    let incrementVal = mode != "edit" ? 1 : 0;

    // find the document and inc the total_reads by 1
    Blog.findOneAndUpdate({ blog_id }, {$inc: {"activity.total_reads": incrementVal}})
    .populate("author", "personal_info.fullname personal_info.username personal_info.profile_img")
    .select("title des content banner activity publishedAt blog_id tags")
    .then(blog => {

        User.findOneAndUpdate({ "personal_info.username": blog.author.personal_info.username}, {
            $inc: { "account_info.total_reads": incrementVal}
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })

        if(blog.draft && !draft) {
            return res.status(500).json({error: "you cannot access draft blogs" })
        }

        return res.status(200).json({ blog });
    })
    .catch(err => {
        return res.status(500).json({ error: err.message});
    })
})

server.post("/like-blog", verifyJWT, (req, res) => {
    let user_id = req.user;
    let { _id, islikedByUser } = req.body;

    let incrementVal = !islikedByUser ? 1 : -1;

    Blog.findOneAndUpdate({ _id }, { $inc: { "activity.total_likes":incrementVal } })
    .then(blog => {
        if(!islikedByUser) {
            let like = new Notification({
                type: "like",
                blog: _id,
                notification_for: blog.author,
                user: user_id
            })

            like.save().then(notification => {
                return res.status(200).json({ liked_by_user: true })
            })
        }
        else {

            Notification.findOneAndDelete({user: user_id, blog: _id, type: "like"})
            .then(data => {
                return res.status(200).json({liked_by_user: false})
            })
            .catch(err => {
                return res.status(500).json({error: err.message})
            })
        }
    })
})

server.post("/isliked-by-user", verifyJWT, (req, res) => {
    let user_id = req.user;
    let { _id }= req.body;

    Notification.exists({user: user_id, type: "like", blog: _id})
    .then(result => {
        return res.status(200).json({result})
    })
    .catch(err => {
        return res.status(500).json({ error: err.message})
    })

})

server.post("/add-comment", verifyJWT, (req, res) => {
    let user_id = req.user;

    let {_id, comment, blog_author} = req.body;

    if(!comment.length) {
        return res.status(403).json({error: "Write something to leave a comment"});
    }

    // Creating a comment doc
    let commentObj = new Comment({
        blog_id: _id,
        blog_author,
        comment, 
        commented_by: user_id,
    })

    commentObj.save().then(commentFile => {
        let { comment, commentedAt, children } = commentFile;

        Blog.findOneAndUpdate({ _id }, { $push: { "comments": commentFile._id }, $inc: {"activity.total_comments": 1}, "activity.total_parent_comments": 1 })
        .then(blog => {
            console.log('New comment created')
        })

        let notificationObj = {
            type: "comment",
            blog: _id,
            notification_for: blog_author,
            user: user_id,
            comment: commentFile._id
        }

        new Notification(notificationObj).save().then(notification => console.log("new Notification created"));

        return res.status(200).json({
            comment, commentedAt, _id: commentFile._id, user_id, children
        })

    })


})

server.listen(PORT, () => {
    console.log('Listeniing on port: ' + PORT);
});