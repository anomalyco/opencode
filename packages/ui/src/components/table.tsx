import { type ComponentProps, splitProps } from "solid-js"

type TableProps = ComponentProps<"table">

export function Table(props: TableProps) {
  const [split, rest] = splitProps(props, ["class"])
  return (
    <div class="relative w-full overflow-auto">
      <table
        classList={{
          "w-full caption-bottom text-sm": true,
          [split.class ?? "split.class"]: true,
        }}
        {...rest}
      />
    </div>
  )
}

type TableHeaderProps = ComponentProps<"thead">

export function TableHeader(props: TableHeaderProps) {
  const [split, rest] = splitProps(props, ["class"])
  return (
    <thead
      classList={{
        "[&_tr]:border-b": true,
        [split.class ?? "split.class"]: true,
      }}
      {...rest}
    />
  )
}

type TableBodyProps = ComponentProps<"tbody">

export function TableBody(props: TableBodyProps) {
  const [split, rest] = splitProps(props, ["class"])
  return (
    <tbody
      classList={{
        "[&_tr:last-child]:border-0": true,
        [split.class ?? "split.class"]: true,
      }}
      {...rest}
    />
  )
}

type TableFooterProps = ComponentProps<"tfoot">

export function TableFooter(props: TableFooterProps) {
  const [split, rest] = splitProps(props, ["class"])
  return (
    <tfoot
      classList={{
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0": true,
        [split.class ?? "split.class"]: true,
      }}
      {...rest}
    />
  )
}

type TableRowProps = ComponentProps<"tr">

export function TableRow(props: TableRowProps) {
  const [split, rest] = splitProps(props, ["class"])
  return (
    <tr
      classList={{
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted": true,
        [split.class ?? "split.class"]: true,
      }}
      {...rest}
    />
  )
}

type TableHeadProps = ComponentProps<"th">

export function TableHead(props: TableHeadProps) {
  const [split, rest] = splitProps(props, ["class"])
  return (
    <th
      classList={{
        "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0": true,
        [split.class ?? "split.class"]: true,
      }}
      {...rest}
    />
  )
}

type TableCellProps = ComponentProps<"td">

export function TableCell(props: TableCellProps) {
  const [split, rest] = splitProps(props, ["class"])
  return (
    <td
      classList={{
        "p-4 align-middle [&:has([role=checkbox])]:pr-0": true,
        [split.class ?? "split.class"]: true,
      }}
      {...rest}
    />
  )
}

type TableCaptionProps = ComponentProps<"caption">

export function TableCaption(props: TableCaptionProps) {
  const [split, rest] = splitProps(props, ["class"])
  return (
    <caption
      classList={{
        "mt-4 text-sm text-muted-foreground": true,
        [split.class ?? "split.class"]: true,
      }}
      {...rest}
    />
  )
}
