/** Plan completion changes without changing hierarchy. */
export function planOutlineCompletion(rows,id,completed){
  const active=rows.filter(r=>r.kind==="sentence"&&r.deleted_at===null);
  const byId=new Map(active.map(r=>[r.id,r]));
  if(!byId.has(id))throw Error("完了対象の項目が見つかりません。");
  const ids=[],seen=new Set();
  if(completed){
    const children=new Map();
    for(const r of active){const a=children.get(r.parent_id)||[];a.push(r.id);children.set(r.parent_id,a);}
    const pending=[id];
    while(pending.length){const key=pending.pop();if(seen.has(key))continue;seen.add(key);ids.push(key);for(const c of children.get(key)||[])pending.push(c);}
  }else{
    let key=id;while(key&&!seen.has(key)&&byId.has(key)){seen.add(key);ids.push(key);key=byId.get(key).parent_id;}
  }
  return ids.map(k=>byId.get(k)).filter(r=>r.is_completed!==completed).map(r=>({id:r.id,previous:r.is_completed,next:completed}));
}
/** Preserve completed ancestors of incomplete legacy rows. */
export function visibleOutlineWithAncestors(rows){
  const byId=new Map(rows.map(r=>[r.id,r])),needed=new Set();
  for(const row of rows){if(row.is_completed)continue;let id=row.id;const seen=new Set();while(id&&!seen.has(id)&&byId.has(id)){seen.add(id);needed.add(id);id=byId.get(id).parent_id;}}
  return rows.filter(r=>needed.has(r.id));
}
