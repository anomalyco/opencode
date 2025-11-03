import * as jose from 'jose'

export async function generateToken(
  roomName: string,
  participantName: string,
  apiKey: string,
  apiSecret: string
): Promise<string> {
  const secret = new TextEncoder().encode(apiSecret)

  const jwt = await new jose.SignJWT({
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    },
    name: participantName,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(participantName)
    .setIssuer(apiKey)
    .setAudience(apiKey)
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret)

  return jwt
}
