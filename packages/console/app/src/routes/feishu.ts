import { redirect } from "@solidjs/router"

export async function GET() {
  return redirect(
    "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=738j8655-cd59-4633-a30a-1124e0096789&qr_code=true",
  )
}
