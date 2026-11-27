import {test} from 'node:test';
import assert from 'node:assert/strict';
import X from 'xlsx';
import fixture from './commission-excel-fixture.cjs';
import {filePeriod,discoverFiles,parseMonth,prepareFiles} from '../src/commission-excel.mjs';
import model from '../public/commission-model.js';
const bufferFiles=f=>[{name:f.payName,book:f.payBook},{name:f.detailName,book:f.detailBook}].map(({name,book})=>{const data=X.write(book,{type:'buffer',bookType:'xlsx'});return {name,size:data.length,arrayBuffer:async()=>data};});
test('monthly discovery handles underscores, accents, new years and refuses duplicate/missing pairs',()=>{
 assert.equal(filePeriod('PAGAMENTOS_MARÇO 2027_GR.xlsx'),'2027-03-01');
 const f=fixture(),files=bufferFiles(f);assert.equal(discoverFiles(files)[0].error,'');assert.ok(discoverFiles([...files,files[0]])[0].error);assert.ok(discoverFiles(files.slice(0,1))[0].error);assert.equal(discoverFiles([{name:'manifest.json'}]).length,0);
});
test('Excel payments reconcile rubrics, seller/chief lines and VP without adding indicators again',()=>{
 const rows=parseMonth(fixture());assert.equal(rows.length,2);assert.equal(rows.reduce((s,r)=>s+r.total,0),50);assert.deepEqual(rows.map(r=>r.payload.records[0].amount),[1,5]);assert.deepEqual(rows.map(r=>r.payload.records[0].credits),[1.5,1.5]);
 assert.equal(rows[1].payload.productionVdd[0].metrics.at(-1).value,'#NAME?');assert.ok(rows.every(r=>r.payload.checks.length===0));assert.equal(rows[1].chief_nif,'100000010');
 assert.equal(model.validateImport({version:1,identities:rows.map(r=>({nif:r.owner_nif,source_name:r.source_name})),rows}).rows.length,2);
});
test('ambiguous layouts, duplicates, missing totals and failed salary formulae stop the import',()=>{
 const missing=fixture();delete missing.payBook.Sheets.Pagamento.BH9.v;missing.payBook.Sheets.Pagamento.BH9.f='SUM(R9:BF9)';assert.throws(()=>parseMonth(missing),/total em falta/);
 const invalid=fixture();invalid.payBook.Sheets.Pagamento.R9={t:'e',v:29,w:'#NAME?'};assert.throws(()=>parseMonth(invalid),/não numérico/);
 const totals=fixture();totals.payBook.Sheets.Pagamento.BH9.v=999;assert.throws(()=>parseMonth(totals),/rubricas/);
 const duplicate=fixture();duplicate.payBook.Sheets.Pagamento.E10.v=100000010;assert.throws(()=>parseMonth(duplicate),/NIF repetido/);
 const columns=fixture();columns.payBook.Sheets.Pagamento.F7.v='Formato diferente';assert.throws(()=>parseMonth(columns),/cabeçalhos/);
 const badNif=fixture();badNif.payBook.Sheets.Pagamento.E10.v='inválido';assert.throws(()=>parseMonth(badNif),/NIF em falta/);
 const unknownRole=fixture();unknownRole.payBook.Sheets.Pagamento.G10.v='Gestor de outro departamento';assert.throws(()=>parseMonth(unknownRole),/função nova/);
});
test('source text is preserved as annotations, never as a monetary zero',()=>{
 const f=fixture();f.payBook.Sheets.Pagamento.S9={t:'n',v:9};f.payBook.Sheets.Pagamento.R9={t:'s',v:'SECÇÃO PESSOAL'};
 const rows=parseMonth(f);assert.equal(rows[0].total,10);assert.deepEqual(rows[0].payload.people[0].sourceAnnotations,[{column:18,value:'SECÇÃO PESSOAL'}]);
});
test('a missing VP is not zero and a real zero is preserved',()=>{
 const f=fixture();f.detailBook.Sheets['Detalhe de Variáveis'].W7.v=0;assert.equal(parseMonth(f)[0].payload.records[0].credits,0);delete f.detailBook.Sheets['Detalhe de Variáveis'].W7;assert.equal(parseMonth(f)[0].payload.records[0].credits,null);
});
test('first use requires an explicit coordination choice and reads real XLSX without altering it',async()=>{
 const files=bufferFiles(fixture('2027-01-01')),before=await files[0].arrayBuffer();
 const choice=await prepareFiles(files,['2027-01-01']);assert.deepEqual(choice.coordinators,['Coord Teste']);assert.equal(choice.needsCoordinator,true);
 const data=await prepareFiles(files,['2027-01-01'],[],'Coord Teste');assert.equal(model.validateImport(data).rows.length,2);assert.equal(data.rows[0].period,'2027-01-01');assert.deepEqual(await files[0].arrayBuffer(),before);
});
