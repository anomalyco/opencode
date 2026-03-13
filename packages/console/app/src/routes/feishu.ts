import { redirect } from "@solidjs/router"

export async function GET() {
  return redirect(
    "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=de8k6664-1b5e-43f2-8efd-21d6772647b5&qr_code=true",
  )
}
