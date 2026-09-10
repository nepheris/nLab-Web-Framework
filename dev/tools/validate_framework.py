#!/usr/bin/env python3
"""nLab framework governance validator.

All active framework JSON artifacts must use Metadata V2. The validator also
checks schemas, canonical references, json_type vocabulary, layered-help
source hygiene, SVG runtime coverage, runtime file wiring, dependencies and
selected single-source-of-truth rules.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
except Exception:
    Draft202012Validator = Registry = Resource = None

ROOT = Path(__file__).resolve().parents[2]
FW = ROOT / "dev" / "framework"
MANIFEST_PATH = FW / "framework-manifest.json"
HELP_ID_RE = re.compile(r'data-help-id\s*=\s*["\']([^"\']+)["\']')
# Runtime icons may be created directly with svg(...) or through the local
# file(...) helper in icons-export.js. Both produce final SVG strings and are
# therefore valid runtime implementations of a registered icon.
ICON_OBJECT_RE = re.compile(r'\b([A-Za-z][A-Za-z0-9_]*)\s*:\s*(?:svg|file)\(')
ICON_ASSIGN_RE = re.compile(r'\bicons\.([A-Za-z][A-Za-z0-9_]*)\s*=\s*(?:svg|file)\(')
REQUIRED_V2 = {"id","json_type","scope","schema_id","artifact_version","introduced_in","status","date_creation","date_mise_a_jour","visibility","supported_runtime_modes"}


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def walk_json():
    for p in sorted(FW.rglob("*.json")):
        yield p, load(p)


def canonical_path(manifest: dict, key: str) -> Path:
    return FW / manifest["Data"]["canonical"][key]


def collect_ids(path: Path, key: str):
    items = load(path).get("Data", {}).get(key, [])
    return {x.get("id") for x in items if isinstance(x, dict) and x.get("id")}


def add(report, level, code, path, message):
    report[level].append({"code":code,"path":str(path.relative_to(ROOT)),"message":message})


def load_schema_registry(path: Path):
    schemas, resources = {}, []
    for entry in load(path).get("Data", {}).get("schemas", []):
        p = (path.parent / entry["path"]).resolve()
        schema = load(p)["Data"]
        schemas[entry["id"]] = schema
        if Resource is not None:
            r = Resource.from_contents(schema)
            resources.append((entry["id"], r))
            if schema.get("$id") and schema["$id"] != entry["id"]:
                resources.append((schema["$id"], r))
    return schemas, Registry().with_resources(resources) if Registry is not None else None


def duplicates(values):
    seen, dup = set(), set()
    for value in values:
        if value in seen: dup.add(value)
        seen.add(value)
    return dup


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", dest="json_out")
    args = ap.parse_args()
    report = {"errors":[],"warnings":[],"info":[]}
    manifest = load(MANIFEST_PATH)
    artifacts = list(walk_json())

    for name, rel in manifest["Data"]["canonical"].items():
        if not (FW / rel).exists(): add(report,"errors","canonical_missing",MANIFEST_PATH,f"{name}: {rel} not found")

    button_path=canonical_path(manifest,"button_registry")
    icon_path=canonical_path(manifest,"icon_registry")
    component_path=canonical_path(manifest,"component_registry")
    theme_path=canonical_path(manifest,"theme_registry")
    schema_path=canonical_path(manifest,"schema_registry")
    help_path=canonical_path(manifest,"help_registry")
    json_type_path=canonical_path(manifest,"json_type_catalog")

    button_items=load(button_path).get("Data",{}).get("buttons",[])
    button_list=[x.get("id") for x in button_items if isinstance(x,dict) and x.get("id")]
    buttons=set(button_list)
    for x in duplicates(button_list): add(report,"errors","duplicate_button_id",button_path,x)

    icon_data=load(icon_path).get("Data",{})
    icon_list=icon_data.get("icons",[])
    icons=set(icon_list)
    for x in duplicates(icon_list): add(report,"errors","duplicate_icon_id",icon_path,x)
    runtime_icons=set()
    for rel in icon_data.get("runtime_files",[]):
        p=icon_path.parent/rel
        if not p.exists():
            add(report,"errors","icon_runtime_file_missing",icon_path,rel); continue
        text=p.read_text(encoding="utf-8")
        runtime_icons.update(ICON_OBJECT_RE.findall(text)); runtime_icons.update(ICON_ASSIGN_RE.findall(text))
    for x in sorted(icons-runtime_icons): add(report,"errors","icon_runtime_missing",icon_path,x)
    for x in sorted(runtime_icons-icons): add(report,"warnings","icon_runtime_unregistered",icon_path,x)

    component_entries=load(component_path).get("Data",{}).get("components",[])
    components={x.get("id") for x in component_entries if x.get("id")}
    for entry in component_entries:
        cfg=entry.get("default_config") if isinstance(entry,dict) else None
        if cfg and not (component_path.parent/cfg).resolve().exists():
            add(report,"errors","component_default_config_missing",component_path,f"{entry.get('id')}: {cfg}")

    themes={x.get("id") for x in load(theme_path).get("Data",{}).get("themes",[]) if x.get("id")}
    schema_ids=collect_ids(schema_path,"schemas")
    schema_store,schema_registry=load_schema_registry(schema_path)
    allowed_json_types=set(load(json_type_path).get("Data",{}).get("types",[]))

    help_entries=load(help_path).get("Data",{}).get("entries",[])
    help_list=[x.get("help_id") for x in help_entries if isinstance(x,dict) and x.get("help_id")]
    help_ids=set(help_list)
    for x in duplicates(help_list): add(report,"errors","duplicate_help_id",help_path,x)

    default_theme=load(theme_path).get("Data",{}).get("default_theme")
    if default_theme not in themes: add(report,"errors","default_theme_unknown",theme_path,str(default_theme))
    if Draft202012Validator is None: add(report,"warnings","jsonschema_unavailable",MANIFEST_PATH,"pip install jsonschema for full schema validation")

    seen_ids,used_help_ids={},set()

    def check_refs(node,path):
        if isinstance(node,dict):
            for k,v in node.items():
                if k=="button_id" and isinstance(v,str) and v not in buttons: add(report,"errors","button_unknown",path,v)
                elif k in {"button_ids","default_buttons"} and isinstance(v,list):
                    for x in v:
                        if isinstance(x,str) and x not in buttons: add(report,"errors","button_unknown",path,x)
                elif k=="icon" and isinstance(v,str) and v not in icons: add(report,"errors","icon_unknown",path,v)
                elif k=="compose" and isinstance(v,list):
                    for x in v:
                        cid=x.get("component") if isinstance(x,dict) else None
                        if cid and cid not in components: add(report,"errors","component_unknown",path,cid)
                check_refs(v,path)
        elif isinstance(node,list):
            for x in node: check_refs(x,path)

    for path,obj in artifacts:
        md=obj.get("metadata") if isinstance(obj,dict) else None
        if not isinstance(md,dict):
            add(report,"errors","metadata_missing",path,"metadata object missing"); continue
        missing=REQUIRED_V2-set(md)
        if missing: add(report,"errors","metadata_v2_required",path,"missing: "+", ".join(sorted(missing)))
        if "version" in md: add(report,"errors","legacy_version_field",path,"metadata.version is forbidden; use artifact_version")
        mid=md.get("id")
        if mid:
            if mid in seen_ids: add(report,"errors","duplicate_id",path,f"also in {seen_ids[mid]}")
            seen_ids[mid]=str(path.relative_to(ROOT))
        jt=md.get("json_type")
        if jt and jt not in allowed_json_types: add(report,"errors","json_type_unknown",path,jt)
        sid=md.get("schema_id")
        if not sid: add(report,"errors","schema_missing",path,"schema_id is required")
        elif sid not in schema_ids and jt!="framework_schema": add(report,"errors","schema_unknown",path,str(sid))
        if obj.get("Data",{}).get("framework_version") and path!=MANIFEST_PATH: add(report,"errors","duplicate_framework_version",path,"framework_version must exist only in framework-manifest.json")
        dd=obj.get("dictionnaire_donnees",{})
        if isinstance(dd,dict) and any(k in dd for k in ("numero_version","date_creation_version","date_mise_a_jour_version")):
            add(report,"errors","legacy_dictionary_versioning",path,"version/date fields must come from metadata/schema, not dictionnaire_donnees")
        hid=md.get("help_id")
        if hid: used_help_ids.add(hid)
        if md.get("json_type")=="framework_component_config" and "public" in md.get("visibility",[]) and hid and hid not in help_ids:
            add(report,"warnings","public_help_missing",path,f"{hid} has no editorial entry; public fallback will be used")
        data=obj.get("Data",{}) if isinstance(obj,dict) else {}
        runtime_ref=data.get("runtime") if isinstance(data,dict) else None
        runtime_refs=runtime_ref if isinstance(runtime_ref,list) else [runtime_ref] if isinstance(runtime_ref,str) else []
        for ref in runtime_refs:
            if isinstance(ref,str) and Path(ref).suffix and not (path.parent/ref).resolve().exists():
                add(report,"errors","runtime_file_missing",path,ref)
        if path.name=="toolbar-full.json":
            for action in data.get("actions",[]):
                if isinstance(action,dict) and any(k in action for k in ("icon","label","button_template")): add(report,"errors","toolbar_duplicates_button_chrome",path,str(action))
            if "button_template" in data: add(report,"errors","toolbar_owns_visual_template",path,"button template must be selected by the theme")
        if not missing and Draft202012Validator is not None and sid in schema_store:
            for err in Draft202012Validator(schema_store[sid],registry=schema_registry).iter_errors(obj):
                where="/".join(map(str,err.absolute_path)) or "root"
                add(report,"errors","schema_validation",path,f"{where}: {err.message}")
        check_refs(obj,path)

    artifact_ids=set(seen_ids)
    for path,obj in artifacts:
        md=obj.get("metadata",{}) if isinstance(obj,dict) else {}
        for dep in md.get("dependencies",[]) if isinstance(md.get("dependencies",[]),list) else []:
            if isinstance(dep,str) and dep not in artifact_ids:
                add(report,"errors","dependency_unknown",path,dep)

    if (FW/"catalogues"/"scopes.json").exists(): add(report,"errors","duplicate_scope_catalog",FW/"catalogues"/"scopes.json","metadata.schema.json is the single source of truth for scope values")
    framework=load(canonical_path(manifest,"framework_definition"))
    if "defaults" in framework.get("Data",{}): add(report,"errors","framework_duplicates_domain_defaults",canonical_path(manifest,"framework_definition"),"domain defaults belong to their own registries/contracts or project configuration")
    runtime=load(canonical_path(manifest,"runtime_modes"))
    if runtime.get("Data",{}).get("primary_mode")!="static": add(report,"errors","static_not_primary",canonical_path(manifest,"runtime_modes"),"static must be the primary runtime mode")
    data_access=load(canonical_path(manifest,"data_access_contract"))
    if data_access.get("Data",{}).get("default_backend") not in {"embedded_json","static_json"}: add(report,"errors","static_backend_not_default",canonical_path(manifest,"data_access_contract"),"default backend must remain static")
    storage_policy=load(canonical_path(manifest,"client_storage_policy"))
    if storage_policy.get("Data",{}).get("default")!="ephemeral_memory": add(report,"errors","persistent_storage_default",canonical_path(manifest,"client_storage_policy"),"client storage must default to ephemeral_memory")
    if storage_policy.get("Data",{}).get("cookie_policy",{}).get("default_enabled") is not False: add(report,"errors","cookies_enabled_by_default",canonical_path(manifest,"client_storage_policy"),"cookies must be disabled by default")
    persistence=load(canonical_path(manifest,"client_persistence"))
    if persistence.get("Data",{}).get("default_adapter")!="memory": add(report,"errors","persistent_draft_default",canonical_path(manifest,"client_persistence"),"draft persistence must default to memory")
    personal=load(canonical_path(manifest,"personal_storage"))
    if personal.get("Data",{}).get("default_provider")!="none": add(report,"errors","personal_storage_enabled_by_default",canonical_path(manifest,"personal_storage"),"personal storage must be opt-in")
    submission=load(canonical_path(manifest,"form_submission"))
    if submission.get("Data",{}).get("adapters",{}).get("mailto_text",{}).get("attachments") is not False: add(report,"errors","mailto_attachment_claim",canonical_path(manifest,"form_submission"),"mailto must not claim reliable automatic attachment support")

    for path in sorted(FW.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".html",".js"}:
            text=path.read_text(encoding="utf-8")
            if "data-help-text=" in text: add(report,"errors","embedded_help_text",path,"use data-help-id and canonical help-registry")
            used_help_ids.update(HELP_ID_RE.findall(text))
    for hid in sorted(help_ids-used_help_ids): add(report,"warnings","unused_help_entry",help_path,hid)

    result={"framework_version":manifest["Data"]["framework_version"],"status":"FAIL" if report["errors"] else "PASS","counts":{k:len(v) for k,v in report.items()},**report}
    text=json.dumps(result,ensure_ascii=False,indent=2); print(text)
    if args.json_out:
        out=Path(args.json_out); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(text+"\n",encoding="utf-8")
    raise SystemExit(1 if report["errors"] else 0)

if __name__=="__main__": main()
