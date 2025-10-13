// @ts-nocheck
import React from "react"
import { Img, Row, Html, Link, Body, Head, Button, Column, Preview, Section, Container } from "@jsx-email/all"
import { Hr, Text, Fonts, SplitString, Title, A, Span, B } from "../components"
import {
  unit,
  body,
  code,
  frame,
  medium,
  heading,
  container,
  headingHr,
  footerLink,
  breadcrumb,
  compactText,
  buttonPrimary,
  breadcrumbColonSeparator,
} from "../styles"

const LOCAL_ASSETS_URL = "/static"
const CONSOLE_URL = "https://opencode.ai/"
const DOC_URL = "https://opencode.ai/docs/zen"

interface InviteEmailProps {
  inviter: string
  workspaceID: string
  workspaceName: string
  assetsUrl: string
}
export const InviteEmail = ({
  inviter = "test@anoma.ly",
  workspaceID = "wrk_01K6XFY7V53T8XN0A7X8G9BTN3",
  workspaceName = "anomaly",
  assetsUrl = LOCAL_ASSETS_URL,
}: InviteEmailProps) => {
  const subject = `You've been invited to join the ${workspaceName} workspace on OpenCode Console`
  const messagePlain = `${inviter} invited you to join the ${workspaceName} workspace.`
  const url = `${CONSOLE_URL}workspace/${workspaceID}`
  return (
    <Html lang="en">
      <Head>
        <Title>{`OpenCode — ${messagePlain}`}</Title>
      </Head>
      <Fonts assetsUrl={assetsUrl} />
      <Preview>{messagePlain}</Preview>
      <Body style={body} id={Math.random().toString()}>
        <Container style={container}>
          <Section style={frame}>
            <Row>
              <Column>
                <A href={`${CONSOLE_URL}zen`}>
                  <Img height="32" alt="OpenCode Logo" src={`${assetsUrl}/logo.png`} />
                </A>
              </Column>
            </Row>

            <Row style={headingHr}>
              <Column>
                <Hr />
              </Column>
            </Row>

            <Section style={{ padding: `${unit}px 0 0 0` }}>
              <Text style={{ ...compactText }}>
                <B>{inviter}</B> invited you to join the{" "}
                <Link style={medium} href={url}>
                  <B>{workspaceName}</B>
                </Link>{" "}
                workspace in the{" "}
                <Link style={medium} href={`${CONSOLE_URL}zen`}>
                  OpenCode Console
                </Link>
                .
              </Text>
            </Section>

            <Section style={{ padding: `${unit}px 0 0 0` }}>
              <Button style={buttonPrimary} href={url}>
                <Span style={code}>Join Workspace</Span>
              </Button>
            </Section>

            <Row style={headingHr}>
              <Column>
                <Hr />
              </Column>
            </Row>

            <Row>
              <Column>
                <Link href={`${CONSOLE_URL}zen`} style={footerLink}>
                  Console
                </Link>
              </Column>
              <Column align="right">
                <Link style={footerLink} href={DOC_URL}>
                  About
                </Link>
              </Column>
            </Row>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default InviteEmail
