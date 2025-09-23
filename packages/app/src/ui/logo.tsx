import type { ComponentProps } from "solid-js"

export interface LogoProps extends ComponentProps<"svg"> {
  variant?: "mark" | "full" | "ornate"
  size?: number
}

export function Logo(props: LogoProps) {
  const { variant = "mark", size = 64, ...others } = props

  if (variant === "mark") {
    return (
      <svg
        width={size}
        height={size * (42 / 64)}
        viewBox="0 0 64 42"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class={`text-text ${props.class ?? ""}`}
        {...others}
      >
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M0 0H32V41.5955H0V0ZM24 8.5H8V33H24V8.5Z"
          fill="currentColor"
        />
        <path d="M40 0H64V8.5H48V33H64V41.5H40V0Z" fill="currentColor" />
      </svg>
    )
  }

  if (variant === "full") {
    return (
      <svg
        width={size * (289 / 42)}
        height={size}
        viewBox="0 0 289 42"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...others}
      >
        <path d="M264.5 0H288.5V8.5H272.5V16.5H288.5V25H272.5V33H288.5V41.5H264.5V0Z" fill="currentColor" />
        <path d="M248.5 0H224.5V41.5H248.5V33H232.5V8.5H248.5V0Z" fill="currentColor" />
        <path d="M256.5 8.5H248.5V33H256.5V8.5Z" fill="currentColor" />
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M184.5 0H216.5V41.5H184.5V0ZM208.5 8.5H192.5V33H208.5V8.5Z"
          fill="currentColor"
        />
        <path d="M144.5 8.5H136.5V41.5H144.5V8.5Z" fill="currentColor" />
        <path d="M136.5 0H112.5V41.5H120.5V8.5H136.5V0Z" fill="currentColor" />
        <path d="M80.5 0H104.5V8.5H88.5V16.5H104.5V25H88.5V33H104.5V41.5H80.5V0Z" fill="currentColor" />
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M40.5 0H72.5V41.5H48.5V49.5H40.5V0ZM64.5 8.5H48.5V33H64.5V8.5Z"
          fill="currentColor"
        />
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M0.5 0H32.5V41.5955H0.5V0ZM24.5 8.5H8.5V33H24.5V8.5Z"
          fill="currentColor"
        />
        <path d="M152.5 0H176.5V8.5H160.5V33H176.5V41.5H152.5V0Z" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg
      width={size * (289 / 42)}
      height={size}
      viewBox="0 0 289 50"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...others}
    >
      <path d="M8.5 16.5H24.5V33H8.5V16.5Z" fill="currentColor" fill-opacity="0.2" />
      <path d="M48.5 16.5H64.5V33H48.5V16.5Z" fill="currentColor" fill-opacity="0.2" />
      <path d="M120.5 16.5H136.5V33H120.5V16.5Z" fill="currentColor" fill-opacity="0.2" />
      <path d="M160.5 16.5H176.5V33H160.5V16.5Z" fill="currentColor" fill-opacity="0.2" />
      <path d="M192.5 16.5H208.5V33H192.5V16.5Z" fill="currentColor" fill-opacity="0.2" />
      <path d="M232.5 16.5H248.5V33H232.5V16.5Z" fill="currentColor" fill-opacity="0.2" />
      <path
        d="M264.5 0H288.5V8.5H272.5V16.5H288.5V25H272.5V33H288.5V41.5H264.5V0Z"
        fill="currentColor"
        fill-opacity="0.95"
      />
      <path d="M248.5 0H224.5V41.5H248.5V33H232.5V8.5H248.5V0Z" fill="currentColor" fill-opacity="0.95" />
      <path d="M256.5 8.5H248.5V33H256.5V8.5Z" fill="currentColor" fill-opacity="0.95" />
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M184.5 0H216.5V41.5H184.5V0ZM208.5 8.5H192.5V33H208.5V8.5Z"
        fill="currentColor"
        fill-opacity="0.95"
      />
      <path d="M144.5 8.5H136.5V41.5H144.5V8.5Z" fill="currentColor" fill-opacity="0.5" />
      <path d="M136.5 0H112.5V41.5H120.5V8.5H136.5V0Z" fill="currentColor" fill-opacity="0.5" />
      <path
        d="M80.5 0H104.5V8.5H88.5V16.5H104.5V25H88.5V33H104.5V41.5H80.5V0Z"
        fill="currentColor"
        fill-opacity="0.5"
      />
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M40.5 0H72.5V41.5H48.5V49.5H40.5V0ZM64.5 8.5H48.5V33H64.5V8.5Z"
        fill="currentColor"
        fill-opacity="0.5"
      />
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M0.5 0H32.5V41.5955H0.5V0ZM24.5 8.5H8.5V33H24.5V8.5Z"
        fill="currentColor"
        fill-opacity="0.5"
      />
      <path d="M152.5 0H176.5V8.5H160.5V33H176.5V41.5H152.5V0Z" fill="currentColor" fill-opacity="0.95" />
    </svg>
  )
}
