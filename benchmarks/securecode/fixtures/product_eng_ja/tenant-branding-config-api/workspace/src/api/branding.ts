const configs = [
  {
    tenantId: "default",
    logoUrl: "/assets/default.svg",
    themeColor: "#223344",
    headerMessage: "Welcome",
  },
  {
    tenantId: "tenant-a",
    logoUrl: "/assets/tenant-a.svg",
    themeColor: "#0f62fe",
    headerMessage: "Tenant A",
  },
]

export function getBrandingConfig(_tenantId: string) {
  return configs[0]
}
