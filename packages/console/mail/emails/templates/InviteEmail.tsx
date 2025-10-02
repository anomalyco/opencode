// @ts-nocheck
import React from "react"
import { Img, Row, Html, Link, Body, Head, Button, Column, Preview, Section, Container } from "@jsx-email/all"
import { Hr, Text, Fonts, SplitString, Title, A, Span } from "../components"
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
  workspace: string
  assetsUrl: string
}
export const InviteEmail = ({ workspace, assetsUrl = LOCAL_ASSETS_URL }: InviteEmailProps) => {
  const subject = `Join the ${workspace} workspace`
  const messagePlain = `You've been invited to join the ${workspace} workspace in the OpenCode Zen Console.`
  const url = `${CONSOLE_URL}workspace/${workspace}`
  return (
    <Html lang="en">
      <Head>
        <Title>{`OpenCode Zen — ${messagePlain}`}</Title>
      </Head>
      <Fonts assetsUrl={assetsUrl} />
      <Preview>{messagePlain}</Preview>
      <Body style={body} id={Math.random().toString()}>
        <Container style={container}>
          <Section style={frame}>
            <Row>
              <Column>
                <A href={CONSOLE_URL}>
                  <Img height="32" alt="OpenCode Zen Logo" src={`${assetsUrl}/zen-logo.png`} />
                </A>
              </Column>
              <Column align="right">
                <Button style={buttonPrimary} href={url}>
                  <Span style={code}>Join Workspace</Span>
                </Button>
              </Column>
            </Row>

            <Row style={headingHr}>
              <Column>
                <Hr />
              </Column>
            </Row>

            <Section>
              <Text style={{ ...compactText, ...breadcrumb }}>
                <Span>OpenCode Zen</Span>
                <Span style={{ ...code, ...breadcrumbColonSeparator }}>:</Span>
                <Span>{workspace}</Span>
              </Text>
              <Text style={{ ...heading, ...compactText }}>
                <Link href={url}>
                  <SplitString text={subject} split={40} />
                </Link>
              </Text>
            </Section>
            <Section style={{ padding: `${unit}px 0 0 0` }}>
              <Text style={{ ...compactText }}>
                You've been invited to join the{" "}
                <Link style={medium} href={url}>
                  {workspace}
                </Link>{" "}
                workspace in the{" "}
                <Link style={medium} href={CONSOLE_URL}>
                  OpenCode Zen Console
                </Link>
                .
              </Text>
            </Section>

            <Row style={headingHr}>
              <Column>
                <Hr />
              </Column>
            </Row>

            <Row>
              <Column>
                <Link href={CONSOLE_URL} style={footerLink}>
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
