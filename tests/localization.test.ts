import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {geometryErrorLabel,localizeError,observationLabel} from '../src/localization';
import {parseCalibration,DEFAULT_CALIBRATION,serializeCalibration} from '../src/state';

const korean=/[가-힣]/;
test('all geometry failure codes have Korean explanations',()=>{
 const reasons=['non-finite','invalid-size','eye-on-screen-plane','eye-on-target-plane','ill-conditioned-screen','parallel-ray','intersection-behind-eye','point-off-target-plane','degenerate-ray'] as const;
 for(const reason of reasons)assert.match(geometryErrorLabel(reason),korean);
});
test('malformed files and browser error wording produce Korean messages',()=>{
 for(const text of ['{','null','{}',JSON.stringify({version:2,calibration:DEFAULT_CALIBRATION})]){
  try{parseCalibration(text);assert.fail('Expected rejection')}catch(e){assert.match(localizeError(e),korean);}
 }
 for(const mutate of [(c:typeof DEFAULT_CALIBRATION)=>c.eye.x=Infinity,(c:typeof DEFAULT_CALIBRATION)=>c.display.widthMm=0,(c:typeof DEFAULT_CALIBRATION)=>c.display.angleDeg=3601]){
  const c=structuredClone(DEFAULT_CALIBRATION);mutate(c);
  try{parseCalibration(serializeCalibration(c));assert.fail('Expected rejection')}catch(e){assert.match(localizeError(e),korean);}
 }
 assert.match(localizeError(new Error('Failed to read file')),korean);
});
test('legacy observation codes render as Korean without changing stored values',()=>{
 for(const value of ['uncertain','yes','no','not-tested','Stable at fixed eye','Fragile / intermittent','Unstable','Attached to screen','Independent plane','No clear target','unknown'])assert.match(observationLabel(value),korean);
});
test('visible static JSX text and messages are localized',()=>{
 const source=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
 const tree=ts.createSourceFile('main.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const visit=(node:ts.Node)=>{
  if(ts.isJsxText(node)){
   const text=node.text.trim();
   if(/[a-z]{3}/i.test(text))assert.ok(korean.test(text)||/^(mm|CSS px|HELLO)$/i.test(text),`Untranslated visible JSX: ${text}`);
  }
  if(ts.isCallExpression(node)&&node.expression.getText(tree)==='setMessage'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text)assert.match(node.arguments[0].text,korean);
  ts.forEachChild(node,visit);
 };visit(tree);
 for(const phrase of ['Generate static image','Original target','Perceptual success','Browser viewport','Invalid geometry','Uncertain','Hide controls','Save observation'])assert.ok(!source.includes(phrase),phrase);
 assert.match(readFileSync(new URL('../index.html',import.meta.url),'utf8'),/lang="ko"/);
 const render=readFileSync(new URL('../src/render.ts',import.meta.url),'utf8');
 for(const phrase of ['fixed eye','virtual plane','physical display','rotation pivot','Orthographic diagram'])assert.ok(!render.includes(phrase),phrase);
 assert.ok(render.includes("fillText('HELLO'"),'Preserve experimental target text');
});
