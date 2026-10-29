import type {WorkContext} from './wiki-knowledge-contract';
export type ContributionSummary={work_context:WorkContext;channel:string;record_id:string};
export function contributionLabel(contribution?:ContributionSummary) {
    const context=contribution?.work_context;
    return context?`${context.actor_name?context.actor_name+' (직접 입력)':'작성 주체 미기록'}${context.session_id?' · 작업 '+context.session_id:''}`:'작성 주체 미기록';
}
