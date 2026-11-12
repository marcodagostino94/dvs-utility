
const states = new Map();
const az = (a,b) => String(a.title || a.name || "").localeCompare(String(b.title || b.name || ""), "it", {numeric:true,sensitivity:"base"});
const state = scope => { if(!states.has(scope)) states.set(scope,{folders:[],current:null,selected:new Set()}); return states.get(scope); };
const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||"";if(text)n.textContent=text;return n;};
export async function loadFolders(db,scope) {
 const s=state(scope);s.current=null;s.selected.clear();
 const r=await db.from("archive_folders").select("*").eq("scope",scope);
 if(r.error) throw new Error("Esegui il file SQL 006 per abilitare le cartelle: "+r.error.message);
 s.folders=(r.data||[]).sort(az);
}
export function chooseFolder(folders,current=null,title="Cartella di destinazione") {
 return new Promise(resolve=>{
 const d=el("dialog","archive-dialog");const h=el("h2","",title);const select=el("select","archive-select");
 const none=el("option","","Senza cartella");none.value="";select.append(none);
 folders.forEach(f=>{const o=el("option","",f.name);o.value=f.id;select.append(o);});select.value=current||"";
 const actions=el("div","archive-actions");const cancel=el("button","secondary-button","Annulla");const ok=el("button","primary-button","Conferma");
 cancel.onclick=()=>d.close();ok.onclick=()=>{resolve(select.value||null);d.close();};
 d.onclose=()=>{resolve(undefined);d.remove();};d.append(h,select,actions);actions.append(cancel,ok);document.body.append(d);d.showModal();
 });
}
export async function destination(db,scope,table,id,payload) {
 const r=await db.from("archive_folders").select("*").eq("scope",scope);
 if(r.error) throw new Error("Esegui la migrazione SQL 006 prima di salvare.");
 let current=null;
 if(id){const old=await db.from(table).select("folder_id").eq("id",id).single();if(old.error)throw old.error;current=old.data.folder_id;}
 const folder=await chooseFolder((r.data||[]).sort(az),current);
 if(folder===undefined) return false;
 payload.folder_id=folder;return true;
}
export function archiveView(db,scope,items,list,query,render) {
 const s=state(scope);
 const normalizedQuery=String(query||"").trim().toLocaleLowerCase("it");
 const visible=items.filter(i=>normalizedQuery
   ? String(i.title||"").toLocaleLowerCase("it").includes(normalizedQuery)||String(i.file_name||"").toLocaleLowerCase("it").includes(normalizedQuery)
   : (i.folder_id||null)===s.current).sort(az);
 let panel=list.previousElementSibling;
 if(!panel?.classList.contains("archive-panel")){panel=el("div","archive-panel");list.before(panel);}
 panel.replaceChildren();
 const tools=el("div","archive-actions");panel.append(tools);
 const button=(label,fn)=>{const b=el("button","secondary-button",label);b.type="button";b.onclick=fn;tools.append(b);return b;};
 const fail=e=>alert(e.message||String(e));
 button("+ Nuova cartella",async()=>{const name=prompt("Nome del programma");if(!name?.trim())return;
 const r=await db.from("archive_folders").insert({scope,name:name.trim()}).select("*").single();if(r.error)return fail(r.error);s.folders.push(r.data);s.folders.sort(az);render();});
 if(s.current){
 button("‹ Tutte le cartelle",()=>{s.current=null;s.selected.clear();render();});
 const folder=s.folders.find(f=>f.id===s.current);
 button("Rinomina",async()=>{const name=prompt("Nome cartella",folder.name);if(!name?.trim())return;const r=await db.from("archive_folders").update({name:name.trim()}).eq("id",folder.id);if(r.error)return fail(r.error);folder.name=name.trim();s.folders.sort(az);render();});
 button("Elimina cartella",async()=>{if(!confirm("Eliminare la cartella? I documenti resteranno disponibili in Senza cartella."))return;const r=await db.from("archive_folders").delete().eq("id",folder.id);if(r.error)return fail(r.error);items.forEach(i=>{if(i.folder_id===folder.id)i.folder_id=null;});s.folders=s.folders.filter(f=>f.id!==folder.id);s.current=null;s.selected.clear();render();});
 }
 const move=button("Sposta selezionati ("+s.selected.size+")",async()=>{
 const dest=await chooseFolder(s.folders,s.current);if(dest===undefined)return;
 const selected=items.filter(i=>s.selected.has(i.kind+":"+i.id));
 const groups=new Map();selected.forEach(i=>{const table=scope==="technical"?(i.kind==="pdf"?"technical_pdf_files":"technical_sheets"):"dcp_audio_reports";if(!groups.has(table))groups.set(table,[]);groups.get(table).push(i);});
 for(const [table,rows] of groups){const r=await db.from(table).update({folder_id:dest}).in("id",rows.map(i=>i.id));if(r.error){fail(r.error);render();return;}rows.forEach(i=>i.folder_id=dest);}
 s.selected.clear();render();
 });move.disabled=!s.selected.size;
 if(!query&&!s.current){
 const grid=el("div","archive-grid "+scope);panel.append(grid);
 s.folders.forEach(f=>{const b=el("button","archive-folder");b.type="button";b.append(el("strong","",f.name),el("small","",items.filter(i=>i.folder_id===f.id).length+" documenti"));b.onclick=()=>{s.current=f.id;s.selected.clear();render();};grid.append(b);});
 }
 panel.append(el("h3","archive-heading",query?"Risultati in tutte le cartelle":s.current?s.folders.find(f=>f.id===s.current)?.name:"Senza cartella"));
 const selectionTools=el("div","archive-actions");
 const selectAll=el("button","secondary-button","Seleziona tutto");
 selectAll.type="button";selectAll.disabled=!visible.length;
 selectAll.onclick=()=>{visible.forEach(i=>s.selected.add(i.kind+":"+i.id));render();};
 const deselectAll=el("button","secondary-button","Deseleziona tutto");
 deselectAll.type="button";deselectAll.disabled=!s.selected.size;
 deselectAll.onclick=()=>{s.selected.clear();render();};
 selectionTools.append(selectAll,deselectAll);panel.append(selectionTools);
 return visible;
}
export function archiveRow(scope,item,button,render,query) {
 const s=state(scope);const wrap=el("div","archive-document");const check=el("input");check.type="checkbox";check.setAttribute("aria-label","Seleziona "+item.title);const key=item.kind+":"+item.id;check.checked=s.selected.has(key);
 check.onchange=()=>{check.checked?s.selected.add(key):s.selected.delete(key);render();};
 if(query){const f=s.folders.find(f=>f.id===item.folder_id);const small=button.querySelector("small");small.textContent+=(small.textContent?" · ":"")+(f?.name||"Senza cartella");}
 wrap.append(check,button);return wrap;
}

