import FileUploadComponent from '@/components/file-upload'
import ChatComponent from '@/components/chat'

export default function Home() {
  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <div className="w-[30vw] h-screen p-4 flex justify-center items-center border-r-2">
        <FileUploadComponent />
      </div>
      <div className="w-[70vw] h-screen">
        <ChatComponent />
      </div>
    </div>
  )
}