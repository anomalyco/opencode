// JDKs print the version inside quotes, and the component count varies: vanilla
// builds use three ("21.0.3") while RHEL's OpenJDK 25 patches print four
// ("25.0.4.1"). Match the major and ignore the rest (#45569).
export function javaVersion(stderr: string): number | undefined {
  const m = /"(\d+)(?:\.\d+)*"/.exec(stderr)
  return m ? parseInt(m[1]) : undefined
}
