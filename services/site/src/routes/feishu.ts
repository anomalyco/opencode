import { redirect } from "@solidjs/router"

export async function GET() {
  return redirect(
    "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=a53kb082-3aff-41fb-b412-b3e669334f16&qr_code=true",
  )
}
