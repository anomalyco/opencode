import { Composition, registerRoot } from "remotion"
import { GLM52Rise } from "./video"
import { NZSheep } from "./sheep"
import { NovelTokens } from "./novel"
import { FlashShare } from "./flash"
import { MiniMaxClimb } from "./minimax"
import { JuneTotals } from "./june"

function Root() {
  return (
    <>
      <Composition id="GLM52Rise" component={GLM52Rise} durationInFrames={240} fps={30} width={1080} height={1080} />
      <Composition id="NZSheep" component={NZSheep} durationInFrames={150} fps={30} width={1080} height={1080} />
      <Composition
        id="NovelTokens"
        component={NovelTokens}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1080}
      />
      <Composition id="FlashShare" component={FlashShare} durationInFrames={165} fps={30} width={1080} height={1080} />
      <Composition
        id="MiniMaxClimb"
        component={MiniMaxClimb}
        durationInFrames={165}
        fps={30}
        width={1080}
        height={1080}
      />
      <Composition id="JuneTotals" component={JuneTotals} durationInFrames={1} fps={30} width={1080} height={1080} />
    </>
  )
}

registerRoot(Root)
