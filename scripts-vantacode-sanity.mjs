// Node sanity runner for VantaCode pure modules. Uses --experimental-strip-types.
// Not part of the build — a fast offline check runnable without Bun.
import { maskSecret, isRetryable, candidatesFromKeys, runWithFailover, AllCandidatesFailedError } from "./packages/opencode/src/vantacode/failover.ts"
import { ExecutionLog, HallucinationStreak, detectHallucination } from "./packages/opencode/src/vantacode/hallucination-guard.ts"
import { validateToolCall, validationRetryMessage } from "./packages/opencode/src/vantacode/tool-validate.ts"
import { diffLines, diffStat, renderDiff } from "./packages/opencode/src/vantacode/diff.ts"
import { computeTunedSettings, normalizeGfx, verifyOffload } from "./packages/opencode/src/vantacode/hardware.ts"
import { resolveKeys, resolveProviders, mergeConfig, selectProvider } from "./packages/opencode/src/vantacode/config.ts"
import { toolCallLine, renderStatusLine, renderTaskList, renderFilesSummary, Renderer } from "./packages/opencode/src/vantacode/renderer.ts"

let pass = 0, fail = 0
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; console.error("FAIL:", msg, "got", JSON.stringify(a), "want", JSON.stringify(b)) } }
const t = (cond, msg) => { if (cond) pass++; else { fail++; console.error("FAIL:", msg) } }

// failover
eq(maskSecret("short"), "****", "mask short")
eq(maskSecret("sk-abcdefghijklmnop"), "sk-a...mnop", "mask long")
t(isRetryable({status:429}).retryable, "429 retryable")
t(!isRetryable({status:400}).retryable, "400 fatal")
t(isRetryable({status:401}).retryable, "401 retryable")
t(isRetryable(new Error("insufficient_quota")).retryable, "quota retryable")

const id = (k)=>k
const noSleep = ()=>Promise.resolve()
{
  const cands = candidatesFromKeys([{provider:"openai",keys:["a","b"],context:id}])
  eq(cands.map(c=>c.id), ["openai#1","openai#2"], "cand ids")
  const r = await runWithFailover(cands, async(c)=>"ok", {sleep:noSleep})
  eq(r.result, "ok", "first success")
}
{
  const cands = candidatesFromKeys([{provider:"openai",keys:["bad","good"],context:id}])
  const r = await runWithFailover(cands, async(c)=>{ if(c.secret==="bad") throw {status:429,message:"rl"}; return "recovered" }, {sleep:noSleep})
  eq(r.result, "recovered", "failover to next key")
}
{
  const cands = candidatesFromKeys([{provider:"a",keys:["x"],context:id},{provider:"b",keys:["y"],context:id}])
  const r = await runWithFailover(cands, async(c)=>{ if(c.provider==="a") throw {status:503,message:"o"}; return "b-served" }, {sleep:noSleep})
  eq(r.candidate.provider, "b", "failover across providers")
}
{
  let calls=0
  try { await runWithFailover(candidatesFromKeys([{provider:"a",keys:["x","y"],context:id}]), async()=>{calls++;throw {status:400,message:"bad"}}, {sleep:noSleep}); t(false,"should throw fatal") }
  catch(e){ t(calls===1, "fatal stops at 1 call") }
}
{
  let err
  try { await runWithFailover(candidatesFromKeys([{provider:"a",keys:["x","y"],context:id}]), async()=>{throw {status:503,message:"o"}}, {sleep:noSleep}) } catch(e){err=e}
  t(err instanceof AllCandidatesFailedError, "AllCandidatesFailedError")
  t(err.attempts.length===2, "2 attempts recorded")
}

// hallucination
{
  const log = new ExecutionLog()
  t(detectHallucination("I've edited the file.", log, false).hallucinated, "edit claim flagged")
  log.record({tool:"edit",args:{},ok:true})
  t(!detectHallucination("I've edited the file.", log, true).hallucinated, "edit claim ok when ran")
  const log2 = new ExecutionLog(); log2.record({tool:"read",args:{},ok:true})
  t(detectHallucination("I've edited the file.", log2, true).hallucinated, "edit claim flagged despite unrelated read")
  t(!detectHallucination("I will edit the file.", new ExecutionLog(), false).hallucinated, "future not flagged")
  t(detectHallucination("I ran the command and the output returned ok.", new ExecutionLog(), false).hallucinated, "shell claim flagged")
  t(!detectHallucination("", new ExecutionLog(), false).hallucinated, "empty not flagged")
}
{
  const s = new HallucinationStreak()
  s.record(true); s.record(true); t(!s.shouldWarn(), "no warn at 2")
  s.record(true); t(s.shouldWarn(), "warn at 3"); eq(s.current,3,"current 3")
  s.record(false); eq(s.current,0,"reset streak"); eq(s.totalCount,3,"total kept")
}

// tool-validate
const editTool = { name:"edit", parameters:{ type:"object", properties:{ file_path:{type:"string"}, old_string:{type:"string"}, new_string:{type:"string"}, max_matches:{type:"integer"} }, required:["file_path","old_string","new_string"] } }
const tools = [editTool]
t(validateToolCall({name:"edit",arguments:{file_path:"a",old_string:"x",new_string:"y"}},tools).ok, "valid call ok")
eq(validateToolCall({name:"nope",arguments:{}},tools).code, "unknown_tool", "unknown tool")
eq(validateToolCall({name:"edit",arguments:{file_path:"a"}},tools).code, "missing_required", "missing required")
eq(validateToolCall({name:"edit",arguments:{file_path:1,old_string:"x",new_string:"y"}},tools).code, "wrong_type", "wrong type")
eq(validateToolCall({name:"edit",arguments:{file_path:"a",old_string:"x",new_string:"y",max_matches:2.5}},tools).code, "wrong_type", "float where int")
t(validateToolCall({name:"edit",arguments:{file_path:"a",old_string:"x",new_string:"y",max_matches:2}},tools).ok, "int ok")
t(validateToolCall({name:"edit",arguments:{file_path:"a",old_string:"x",new_string:"y",extra:true}},tools).ok, "extra prop ok")

// diff
{
  const s = diffStat(diffLines("a\nb\nc","a\nB\nc")); eq(s,{added:1,removed:1},"single change")
  eq(diffStat(diffLines("a","a\nb\nc")),{added:2,removed:0},"additions")
  eq(diffStat(diffLines("a\nb\nc","a")),{added:0,removed:2},"deletions")
  eq(diffStat(diffLines("x\ny","x\ny")),{added:0,removed:0},"identical")
  const out = renderDiff("a\nb\nc","a\nB\nc",{color:false}); t(out.includes("- b")&&out.includes("+ B"),"render markers")
  const big = Array.from({length:30},(_,i)=>`l${i}`).join("\n"); const out2 = renderDiff(big, big.replace("l0","CH"), {color:false,context:2}); t(out2.includes("unchanged line"),"collapse")
}

// hardware
eq(normalizeGfx("gfx1030"),"10.3.0","gfx1030")
eq(normalizeGfx("gfx900"),"9.0.0","gfx900")
eq(normalizeGfx("gfx1100"),"11.0.0","gfx1100")
t(normalizeGfx("junk")===undefined,"gfx junk")
{
  const gpu={vendor:"nvidia",name:"4090",vramTotalMB:24000}
  const tuned=computeTunedSettings({hardware:{platform:"linux",cpuThreads:16,totalRamMB:32000,gpus:[gpu],primaryGpu:gpu}})
  eq(tuned.options.num_gpu,999,"nvidia num_gpu"); eq(tuned.env.OLLAMA_FLASH_ATTENTION,"1","flash"); eq(tuned.options.num_thread,14,"threads-2"); eq(tuned.env.OLLAMA_NUM_PARALLEL,"4","parallel")
  const cpu=computeTunedSettings({hardware:{platform:"linux",cpuThreads:4,totalRamMB:8000,gpus:[],primaryGpu:undefined}})
  eq(cpu.options.num_gpu,0,"cpu num_gpu")
  const amdgpu={vendor:"amd",name:"6800",vramTotalMB:16000,gfx:"gfx1030"}
  const amd=computeTunedSettings({hardware:{platform:"linux",cpuThreads:16,totalRamMB:32000,gpus:[amdgpu],primaryGpu:amdgpu}})
  eq(amd.env.HSA_OVERRIDE_GFX_VERSION,"10.3.0","amd hsa"); eq(amd.env.OLLAMA_COMPUTE_TYPE,"f16","amd compute")
}
eq(verifyOffload(999,{size:1000,size_vram:950}).status,"gpu","offload gpu")
eq(verifyOffload(999,{size:1000,size_vram:0}).status,"cpu","offload cpu")
eq(verifyOffload(999,{size:1000,size_vram:500}).status,"partial","offload partial")
eq(verifyOffload(999,undefined).status,"unknown","offload unknown")

// config
eq(resolveKeys("OPENAI_API_KEY",{OPENAI_API_KEY:"a,b,c"}),["a","b","c"],"multi-key split")
eq(resolveKeys("OPENAI_API_KEY",{OPENAI_API_KEY:"a", OPENAI_API_KEYS:"b,c"}),["a","b","c"],"plural merge")
{
  const provs = resolveProviders({env:{}})
  t(provs.find(p=>p.id==="ollama")!==undefined,"ollama preset present")
  const cfg = mergeConfig({env:{VANTACODE_PROVIDER:"openai", OPENAI_API_KEY:"sk-xxxx"}})
  eq(cfg.defaultProvider,"openai","default provider from env")
  const sel = selectProvider(cfg,"openai"); t(sel && sel.id==="openai","select openai")
}

// renderer
eq(toolCallLine("Bash",{command:"ls -la /tmp"}),"Bash: ls -la /tmp","tool line bash")
t(toolCallLine("edit",{file_path:"src/x.ts"}).startsWith("edit: src/x.ts"),"tool line edit")
t(renderStatusLine({provider:"ollama",model:"qwen",gpu:"RTX",vramMB:24000,permissionMode:"auto-edit"},false).includes("ollama/qwen"),"status line")
t(renderTaskList([{id:"1",title:"do",state:"complete"}],false).includes("do"),"task list")
t(renderFilesSummary(["/a/b.ts"],false).includes("b.ts"),"files summary")
{
  const lines=[]; const r=new Renderer({write:(l)=>lines.push(l)}, false)
  r.handle({type:"tool-call",name:"Bash",args:{command:"echo hi"}})
  r.handle({type:"tool-result",name:"Bash",ok:true,output:"hi"})
  t(lines.join("").includes("Bash: echo hi"),"renderer tool-call")
  t(r.fullTranscript.includes("tool-call"),"transcript")
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail>0?1:0)
