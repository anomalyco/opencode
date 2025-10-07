import { JSX } from "solid-js"

export function IconLogo(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
  <svg {...props} width="234" height="42" viewBox="0 0 234 42" fill="none"
       xmlns="http://www.w3.org/2000/svg">
    <path fill-rule="evenodd" clip-rule="evenodd"
          d="M54 36H36V42H30V6H54V36ZM36 30H48V12H36V30Z" fill="currentColor"/>
    <path fill-rule="evenodd" clip-rule="evenodd"
          d="M24 36H0V6H24V36ZM6 30H18V12H6V30Z" fill="currentColor"/>
    <path fill-rule="evenodd" clip-rule="evenodd"
          d="M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z" fill="currentColor"/>
    <path d="M108 12H96V36H90V6H108V12Z" fill="currentColor"/>
    <path d="M114 36H108V12H114V36Z" fill="currentColor"/>
    <path d="M144 12H126V30H144V36H120V6H144V12Z" fill="currentColor"/>
    <path fill-rule="evenodd" clip-rule="evenodd"
          d="M174 36H150V6H174V36ZM156 30H168V12H156V30Z" fill="currentColor"/>
    <path fill-rule="evenodd" clip-rule="evenodd"
          d="M204 36H180V6H198V0H204V36ZM186 30H198V12H186V30Z" fill="currentColor"/>
    <path fill-rule="evenodd" clip-rule="evenodd"
          d="M234 24H216V30H234V36H210V6H234V24ZM216 18H228V12H216V18Z" fill="currentColor"/>
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
