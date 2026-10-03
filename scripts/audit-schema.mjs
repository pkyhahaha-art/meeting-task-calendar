// Generate a read-only comparison of app Row types with the live catalog.
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const source = ts.createSourceFile('database.types.ts', readFileSync('src/lib/database.types.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const database = source.statements.find((node) => ts.isInterfaceDeclaration(node) && node.name.text === 'Database')
const member = (node, name) => node.members.find((item) => item.name?.getText(source) === name).type
const tables = member(member(database, 'public'), 'Tables')
const expected = tables.members.flatMap((table) => member(table.type, 'Row').members.map((column) => {
  const types = ts.isUnionTypeNode(column.type) ? column.type.types : [column.type]
  const nullable = types.some((type) => type.getText(source) === 'null')
  const valueTypes = types.filter((type) => type.getText(source) !== 'null')
  const primitive = valueTypes.every((type) => type.kind === ts.SyntaxKind.BooleanKeyword) ? 'boolean'
    : valueTypes.every((type) => type.kind === ts.SyntaxKind.NumberKeyword) ? 'number'
      : valueTypes.every((type) => type.kind === ts.SyntaxKind.StringKeyword || (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal))) ? 'string' : 'json'
  return `('${table.name.getText(source)}','${column.name.getText(source)}','${primitive}',${nullable})`
}))
const sql = `begin read only;
with expected(table_name,column_name,primitive,nullable) as (values
${expected.join(',\n')}
), compared as (
select e.*,c.udt_name,c.is_nullable,
  c.column_name is null as missing,
  c.column_name is not null and (case e.primitive
    when 'boolean' then c.udt_name <> 'bool'
    when 'number' then c.udt_name not in ('int2','int4','int8','numeric','float4','float8')
    when 'string' then c.udt_name not in ('text','varchar','uuid','date','time','timestamp','timestamptz')
    else c.udt_name not in ('json','jsonb') end or e.nullable <> (c.is_nullable='YES')) as mismatch
from expected e left join information_schema.columns c on c.table_schema='public'
  and c.table_name=e.table_name and c.column_name=e.column_name
)
select 'typescript_rows' as check_name,jsonb_build_object('checked',count(*),'missing',count(*) filter(where missing),'mismatched',count(*) filter(where mismatch),'details',coalesce(jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'database_type',udt_name,'database_nullable',is_nullable)) filter(where missing or mismatch),'[]'::jsonb))::text as result from compared
union all select 'rls',jsonb_build_object('tables',count(*),'disabled',count(*) filter(where not c.relrowsecurity))::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
union all select 'foreign_keys',jsonb_build_object('checked',count(*),'not_valid',count(*) filter(where not convalidated))::text from pg_constraint where contype='f' and connamespace='public'::regnamespace
union all select 'queue_helper',jsonb_build_object('anon',has_function_privilege('anon','public.queue_notification(uuid,uuid,text,text,text,jsonb,timestamptz)','execute'),'authenticated',has_function_privilege('authenticated','public.queue_notification(uuid,uuid,text,text,text,jsonb,timestamptz)','execute'),'worker',has_function_privilege('service_role','public.queue_notification(uuid,uuid,text,text,text,jsonb,timestamptz)','execute'))::text
union all select 'profile_update_columns',jsonb_agg(column_name order by column_name)::text from information_schema.column_privileges where table_schema='public' and table_name='profiles' and grantee='authenticated' and privilege_type='UPDATE'
union all select 'new_indexes',jsonb_agg(indexname order by indexname)::text from pg_indexes where schemaname='public' and indexname in ('attachments_event_idx','task_attachments_task_idx','notification_deliveries_event_created_idx','notification_deliveries_task_created_idx')
union all select 'system_jobs_7_days',coalesce(jsonb_agg(row_to_json(summary)),'[]'::jsonb)::text from (select job_name,status,count(*) as count from public.system_logs where created_at>=now()-interval '7 days' group by job_name,status) summary
union all select 'delivery_results_7_days',coalesce(jsonb_agg(row_to_json(summary)),'[]'::jsonb)::text from (select channel,status,error_code,count(*) as count from public.notification_deliveries where created_at>=now()-interval '7 days' group by channel,status,error_code) summary;
rollback;
`
writeFileSync('docs/audits/2026-10-04-schema-check.sql', sql)
console.log(`Generated read-only schema check for ${expected.length} application columns`)
