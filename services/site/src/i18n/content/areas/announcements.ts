import { announcements } from "~/component/site/announcement"

/** The home announcement's English copy, when Settings turns it on. Matched by its English text. */
export const announcementsSource = announcements.map((item) => ({ text: item.text, link: item.link }))
