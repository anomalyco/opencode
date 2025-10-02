import { JSX } from "solid-js"

export function IconLogo(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 289 50" fill="none" xmlns="http://www.w3.org/2000/svg">
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

export function IconCopy(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg {...props} width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8.75 8.75V2.75H21.25V15.25H15.25M15.25 8.75H2.75V21.25H15.25V8.75Z"
        stroke="#8E8B8B"
        stroke-width="1.5"
        stroke-linecap="square"
      />
    </svg>
  )
}

export function IconCheck(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg {...props} width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.75 15.0938L9 20.25L21.25 3.75" stroke="#03B000" stroke-width="2" stroke-linecap="square" />
    </svg>
  )
}

export function IconCreditCard(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"
      />
    </svg>
  )
}
