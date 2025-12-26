import { UnstructuredLoader } from "@langchain/community/document_loaders/fs/unstructured";

const loader = new UnstructuredLoader(
    "D:\\Academia\\Semester 5\\AI\chatbot\\data\\au-fee-structure.pdf"
)

const docs = await loader.load()

console.log(docs[0]);