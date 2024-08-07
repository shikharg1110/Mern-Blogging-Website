// Here when someone is logged in then only we will want to show the editor page. So, we will use the access token to check if the user is logged in or not.

import { useContext, useEffect, useState } from "react";
import { UserContext } from "../App";
import { Navigate, useParams } from "react-router-dom";
import BlogEditor from '../components/blog-editor.component';
import PublishForm from '../components/publish-form.component';
import { createContext } from "react";
import Loader from "../components/loader.component";
import axios from "axios";

// empty structure for our blog data items
const blogStructure = {
    title: '',
    banner: '',
    content: [],
    tags: [],
    des: '', 
    author: { personal_info: { } }
}

// to store the value of blog data item blogStructure
export const EditorContext = createContext({ });

const   Editor = () => {

    let { blog_id } = useParams();

    // WE have to make this state so that it is parent file for Blog Editor page and Publish Draft page
    const [ blog, setBlog ] = useState(blogStructure)

    const [ editorState, setEditorState ] = useState("editor"); // to show blogEditor or PublishForm 

    // TO Track the editor if we move to next page
    // isReady is the function used for EditorJS library
    
    const [textEditor, setTextEditor] = useState({ isReady: false});

    const [ loading , setLoading ] = useState(true);

    let { userAuth: { access_token } } = useContext(UserContext);

    useEffect(() => {
        if(!blog_id) {
            return setLoading(false);
        }

        axios.post(import.meta.env.VITE_SERVER_DOMAIN + "/get-blog", {blog_id, draft: true, mode: "edit"})
        .then(({data: {blog}}) => {
            setBlog(blog);
            setLoading(false);
        })
        .catch(err => {
            setBlog(null);
            setLoading(false);
        })
    }, [])

    // EditorContext.Provider is like a component which has access to EditorContext of Context React Hook
    return (
        <>
         
            <EditorContext.Provider value={ {blog, setBlog, editorState, setEditorState, textEditor, setTextEditor} }>
                {
                    access_token === null ? 
                    <Navigate to="/signin" /> 
                    : 
                    loading ? <Loader /> :
                    editorState == "editor" ? 
                    <BlogEditor /> : <PublishForm />
                }
            </EditorContext.Provider>
        </>
    )
}

export default Editor;