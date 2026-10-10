import { EditorDialog } from "./EditorDialog";
import type { AiTaskStage } from "../lib/ai-contract";
const labels:Record<AiTaskStage,string>={idle:"待开始",preparing:"正在准备全文字幕",analyzing:"正在分析字幕",matching:"正在匹配重点效果",validating:"正在确认包装结果",applied:"AI 分析结果",failed:"AI 分析结果",cancelled:"任务已取消",stale:"结果已过期，未应用"};
export function AiTaskDialog({stage,error,batches,packagedCount=0,totalCues=0,onCancel,onClose}:{stage:AiTaskStage;error?:string;batches?:string;packagedCount?:number;totalCues?:number;onCancel:()=>void;onClose:()=>void}){
  const busy=["preparing","analyzing","matching","validating"].includes(stage);
  const finished=stage==="applied"||stage==="failed";
  return <EditorDialog title={labels[stage]} onClose={busy?onCancel:onClose}>
    <p role="status">{stage==="failed"?"AI 分析未完成，当前包装已保留，可进入工作台。":finished?`已根据 AI 分析包装 ${packagedCount} / ${totalCues} 句字幕。`:busy?"正在理解字幕并匹配本地效果。":error??"工程内容保留，可继续编辑。"}</p>
    {finished&&<p>如有卡片建议，可在右侧查看并校准。</p>}
    {busy&&batches&&<small>{batches}</small>}
    <footer>{busy?<button className="button secondary" onClick={onCancel}>取消分析</button>:<button className="button primary" onClick={onClose}>{finished?"进入工作台":"返回工作台"}</button>}</footer>
  </EditorDialog>;
}
