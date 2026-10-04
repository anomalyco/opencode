import { redirect } from "@solidjs/router"

export async function GET() {
  return redirect(
    "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=52ao9352-5623-4fa0-b7dd-3407c392c1af&qr_code=true",
  )
}
