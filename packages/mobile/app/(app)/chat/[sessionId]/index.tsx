import { useLocalSearchParams } from "expo-router"
import { ChatPage } from "@/components/pages/chat"

const Page = () => {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()

  if (!sessionId) {
    return null
  }

  return <ChatPage sessionId={sessionId} />
}

export default Page
