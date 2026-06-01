type Props = {
  size?: number
  hidden?: number
  dashed?: boolean
}

export function MoreIndicator(props: Props) {
  const size = () => props.size ?? 32
  const title = () => (props.hidden && props.hidden > 0 ? `${props.hidden}명 더` : "더 있음")

  return (
    <div class="ds-more" title={title()}>
      <div
        class="ds-more__circle"
        classList={{ "ds-more__circle--solid": !props.dashed }}
        style={{ width: `${size()}px`, height: `${size()}px`, "font-size": `${Math.round(size() * 0.42)}px` }}
      >
        ···
      </div>
    </div>
  )
}
