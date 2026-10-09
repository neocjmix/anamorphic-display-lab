import test from 'node:test';import assert from 'node:assert/strict';
import {compositePane,paneBlendWeight,PANE_RGB} from '../src/pane.ts';
const pane={enabled:true,opacity:.4};
test('front target retains original RGB, rear target is blue tinted',()=>{assert.deepEqual(compositePane([255,180,20],.7,pane),[255,180,20]);assert.deepEqual(compositePane([255,180,20],1.4,pane),[255*.6+35*.4,180*.6+130*.4,20*.6+235*.4]);});
test('background blue and toggle/zero opacity reproduce baseline',()=>{assert.deepEqual(compositePane([0,0,0],null,pane),PANE_RGB.map(c=>c*.4));assert.deepEqual(compositePane([40,50,60],2,{enabled:false,opacity:1}),[40,50,60]);assert.equal(paneBlendWeight(1,pane),0);assert.equal(paneBlendWeight(2,{enabled:true,opacity:0}),0);});
