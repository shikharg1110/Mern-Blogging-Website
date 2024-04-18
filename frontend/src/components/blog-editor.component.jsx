import { Link } from 'react-router-dom';
import logo  from '../imgs/logo.png';
import AnimationWrapper from '../common/page-animation';
import defaultBanner from '../imgs/blog banner.png'
import { uploadImage } from '../common/aws';
import { useContext, useEffect } from 'react';
import { Toaster, toast} from 'react-hot-toast';
import { EditorContext } from '../pages/editor.pages';
import EditorJS from '@editorjs/editorjs';
import { tools } from './tools.component';

const BlogEditor = () => {

    let { blog, blog: { title, banner, content, tags, des }, setBlog, textEditor, setTextEditor, setEditorState} = useContext(EditorContext);

    // after render runs once which is used for editing page
    useEffect( () => {
        setTextEditor(new EditorJS({
            holderId: "textEditor", 
            data: content,
            tools: tools,
            placeholder: "Let's write an awesome story"
        }));
    }, []);

    const handleBannerUpload = (e) => {
        let img = e.target.files[0];
        
        if(img) {

            let loadingToast = toast.loading("Uploading...")
            uploadImage(img).then((url) => {
                if(url) {
                    toast.dismiss(loadingToast);
                    toast.success("Uploaded 👍")
                    setBlog({...blog, banner: url}) 
                }
            })
            .catch(err => {
                toast.dismiss(loadingToast);
                return toast.error(err);
            })
        }
    }

    const handleTitleKeyDown =(e) => {
        // keyCode is just ascii value of the input value so if you press enter it is equl to 13
        if(e.keyCode === 13) {
            e.preventDefault();
        }
    }

    const handleTitleChange = (e) => {
        // e.target states the textarea in which this func is present
        let input = e.target;
        
        input.style.height = "auto";
        input.style.height = input.scrollHeight + "px";

        setBlog( { ...blog, title: input.value})
    }

    // since img src is banner which we get when we upload the image so error is generated 
    const handleError = (e) => {
        let img = e.target;
        img.src = defaultBanner;
    }

    const handlePublishEvent = () => {
        // validate data before publish
        if(!banner.length) {
            return toast.error("Upload a blog banner to publish it");
        }

        if(!title.length) {
            return toast.error("Write blog title to publish it");
        }

        if(textEditor.isReady) {
            // save function convert the json data to array blocks
            textEditor.save().then(data => {
                if(data.blocks.length) {
                    setBlog({ ...blog, content: data });
                    setEditorState("publish");
                }
                else {
                    return toast.error("Write something in your blog to publish it");
                }
            })
            .catch((err) => {
                console.log(err);
            })
        }
    }

    return (
        <>
            <nav className='navbar'>
                <Link to="/" className='flex-none w-10'>
                    <img src={logo} alt="logo" />
                </Link>
                <p className='max-md:hidden text-black line-clamp-1 w-full'>
                    {title.length ? title: "New Blog" }
                </p>

                <div className='flex gap-4 ml-auto'>
                    <button className='btn-dark py-2' onClick={handlePublishEvent}>
                        Publish
                    </button>
                    <button className='btn-light py-2'>
                        Save Draft
                    </button>
                </div>
            </nav>

            <Toaster />
            <AnimationWrapper>
                <section>
                    <div className='mx-auto max-w-[900px] w-full'>

                        <div className='relative aspect-video bg-white border-4 border-grey hover:opacity-80'>
                            <label htmlFor='uploadBanner'>
                                <img 
                                    src={banner} 
                                    className='z-20'
                                    alt="Upload your banner"
                                    onError={handleError}
                                />
                                <input
                                    id='uploadBanner'
                                    type='file'
                                    accept='.png, .jpg, .jpeg'
                                    hidden  
                                    onChange={handleBannerUpload}        
                                />
                            </label>
                        </div>

                        <textarea
                            defaultValue={title}
                            placeholder='Blog title'
                            className='text-4xl font-medium w-full h-20 outline-none resize-none mt-10 leading-tight placeholder:opacity-40'
                            onKeyDown={handleTitleKeyDown}
                            onChange={handleTitleChange}
                        >
                        </textarea>

                        <hr className='w-full opacity-10 my-5'/>

                        <div id="textEditor" className='font-gelasio'></div>

                    </div>
                </section>
            </AnimationWrapper>
        </>
    )
}

export default BlogEditor;

// Working
/* 
1. Here new navbar is used
2. p is add of "New Blog" which is not visible in shorter screen and visible only on above mobile screen
3. line-clamp-1 is used if more space is used in navbar then "New Blog" will look something like "New B.."
*/