// @ts-nocheck
import React from "react"
import { Img, Row, Html, Link, Body, Head, Button, Column, Preview, Section, Container } from "@jsx-email/all"
import { Text, Fonts, Title, A, Span } from "../components"
import { unit, body, frame, headingText, container, contentText, button, contentHighlightText, linkText, buttonText } from "../styles"

const CONSOLE_URL = "https://opencode.ai/"

interface EmailChangeConfirmEmailProps {
  oldEmail: string
  newEmail: string
  url: string
  kind: "old" | "new"
  assetsUrl: string
}

export const EmailChangeConfirmEmail = ({
  oldEmail = "old@example.com",
  newEmail = "new@example.com",
  url = CONSOLE_URL,
  kind = "old",
  assetsUrl = `${CONSOLE_URL}email`,
}: EmailChangeConfirmEmailProps) => {
  const action = kind === "old" ? "confirm this change" : "verify your new email"
  const preview = `OpenCode email change: ${oldEmail} to ${newEmail}`
  return (
    <Html lang="en">
      <Head>
        <Title>{`OpenCode — ${preview}`}</Title>
      </Head>
      <Fonts assetsUrl={assetsUrl} />
      <Preview>{preview}</Preview>
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

            <Section style={{ padding: `${unit * 2}px 0 0 0` }}>
              <Text style={headingText}>Confirm your OpenCode email change</Text>
              <Text style={contentText}>
                We received a request to change your OpenCode account email from{" "}
                <Span style={contentHighlightText}>{oldEmail}</Span> to{" "}
                <Span style={contentHighlightText}>{newEmail}</Span>.
              </Text>
              <Text style={contentText}>Click below to {action}. This link expires soon.</Text>
            </Section>

            <Section style={{ padding: `${unit}px 0 0 0` }}>
              <Button style={button} href={url}>
                <Text style={buttonText}>
                  {kind === "old" ? "Confirm change" : "Verify new email"}
                  <Img width="24" height="24" src={`${assetsUrl}/right-arrow.png`} alt="Arrow right" />
                </Text>
              </Button>
            </Section>

            <Section style={{ padding: `${unit}px 0 0 0` }}>
              <Text style={contentText}>Button not working? Copy the following link...</Text>
              <Link href={url}>
                <Text style={linkText}>{url}</Text>
              </Link>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default EmailChangeConfirmEmail
