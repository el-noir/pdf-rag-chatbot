import { UnstructuredLoader } from "@langchain/community/document_loaders/fs/unstructured";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use a file from the uploads directory
const filePath = path.join(__dirname, 'uploads', '1766767030459-685100144-au-policies.pdf');

// Use the full endpoint path for the local unstructured API
const loader = new UnstructuredLoader(
    filePath,
    {
        apiUrl: "http://localhost:5000/general/v0/general"
    }
)

const docs = await loader.load()

console.log(`Loaded ${docs.length} documents`);
console.log('First document:', docs[0]);