const $ = id => document.getElementById(id);
const controls = ['sensor','room','power','data','ground','pullup','interval'];
const state = {attempts:0, successes:0, failures:0, samples:[], events:[], timer:null};
const presets = {normal:[24.2,52.4], warm:[30.6,43.2], humid:[25.4,78.5]};
const sampleOffsets = [[0,0],[.2,-.3],[-.1,.4],[.1,.1],[-.2,-.2],[.3,.2]];
function config(){return Object.fromEntries(controls.map(k=>[k,$(k).value]));}
function reason(c){
 if(c.power==='5v') return ['unsafe','5 V selected. Stop: this lesson blocks the circuit because DATA can rise above the Pi’s 3.3 V GPIO level. Use pin 1 (3.3 V).'];
 if(c.power==='off') return ['error','VCC is disconnected. The sensor cannot respond; connect physical pin 1 (3.3 V).'];
 if(c.ground==='off') return ['error','GND is disconnected. Connect physical pin 6 to share a ground.'];
 if(c.data==='off') return ['error','DATA is disconnected. Connect the sensor to physical pin 7 (GPIO4).'];
 if(c.data==='gpio17') return ['error','DATA is on GPIO17, but the supplied code reads GPIO4. Move it to physical pin 7.'];
 if(Number(c.interval)<2) return ['error','Polling is too fast for this lesson. Set at least 2 seconds before reading.'];
 if(c.pullup==='no') return ['warning','The bare sensor has no DATA pull-up. This simulation alternates a successful read with a checksum failure to show an intermittent fault.'];
 return ['ready','Circuit and interval are ready. Read a sample to inspect the transaction.'];
}
function setText(id,value){$(id).textContent=value;}
function drawWires(c){
 for(const [id,bad] of [['wire-power',c.power!=='3v3'],['wire-data',c.data!=='gpio4'],['wire-ground',c.ground!=='connected']]) $(id).classList.toggle('broken',bad);
 const resistorOn=c.pullup==='yes'; for(const id of ['wire-pullup','wire-pullup-b','resistor','pullup-label']) $(id).classList.toggle('absent',!resistorOn);
 setText('sensor-diagram-name',c.sensor+' SENSOR');
 const explanation=`Raspberry Pi 5: ${c.power==='3v3'?'physical pin 1, 3.3 volts':c.power==='5v'?'unsafe 5 volt choice':'power disconnected'} to VCC; ${c.data==='gpio4'?'physical pin 7, GPIO4':c.data==='gpio17'?'GPIO17, mismatched with code':'DATA disconnected'} to DATA; ${c.ground==='connected'?'physical pin 6 to ground':'ground disconnected'}; ${resistorOn?'4.7 to 10 kilohm pull-up connected':'pull-up absent'}.`;
 $('circuit-desc').textContent=explanation;
}
function code(c){return `#!/usr/bin/env python3
import argparse
import time
import board
import adafruit_dht

parser = argparse.ArgumentParser()
parser.add_argument("--sensor", choices=("dht11", "dht22"),
                    default="${c.sensor.toLowerCase()}")
args = parser.parse_args()
kind = adafruit_dht.DHT11 if args.sensor == "dht11" else adafruit_dht.DHT22
sensor = kind(board.D4, use_pulseio=False)  # physical pin 7
try:
    while True:
        try:
            t, rh = sensor.temperature, sensor.humidity
            if t is not None and rh is not None:
                print(f"{t:.1f} C | {rh:.1f} % RH")
            else:
                print("No complete reading; retrying.")
        except RuntimeError as error:
            print(f"Transient read error: {error}; retrying.")
        time.sleep(2.0)
except KeyboardInterrupt:
    print("Stopped.")
finally:
    sensor.exit()`;}
function updateConfig(){const c=config(),[kind,message]=reason(c);
 $('diagnosis').className='diagnosis '+kind;$('diagnosis').textContent=message;
 $('interval-out').value=Number(c.interval).toFixed(1)+' s';drawWires(c);
 $('code-view').textContent=code(c);
 if(state.timer && kind!=='ready' && kind!=='warning') stopPolling();
}
function bytesFor(t,h,sensor){
 if(sensor==='DHT11') {const hi=Math.round(h),ti=Math.round(t);return [hi,0,ti,0,(hi+ti)&255];}
 const rawH=Math.round(h*10),rawT=Math.round(Math.abs(t)*10),temp=(t<0?0x8000:0)|rawT;
 const bytes=[rawH>>8,rawH&255,temp>>8,temp&255];return [...bytes,bytes.reduce((a,b)=>a+b,0)&255];
}
function setTrace(items){$('trace-steps').replaceChildren(...items.map(item=>{const li=document.createElement('li');li.textContent=item;return li;}));}
function log(message){const line=document.createElement('div');line.textContent=message;$('terminal').prepend(line);while($('terminal').childElementCount>12)$('terminal').lastElementChild.remove();}
function drawChart(){const svg=$('chart'),samples=state.samples.slice(-12);
 svg.replaceChildren();const ns='http://www.w3.org/2000/svg';
 const make=(name,attributes)=>{const el=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attributes))el.setAttribute(k,String(v));svg.append(el);return el;};
 for(const y of [27,56,85]) make('line',{x1:12,y1:y,x2:588,y2:y,stroke:'#2b4b5d','stroke-width':1});
 if(samples.length===0){const label=make('text',{x:300,y:62,fill:'#9fb7c1','text-anchor':'middle','font-size':14});label.textContent='No successful samples yet';return;}
 for(const [key,min,max,color] of [['temperature',15,40,'#ffd082'],['humidity',20,90,'#79d9ed']]){
  const points=samples.map((s,i)=>`${samples.length===1?300:16+i*568/(samples.length-1)},${98-(s[key]-min)/(max-min)*84}`).join(' ');
  make('polyline',{points,fill:'none',stroke:color,'stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'});
  samples.forEach((s,i)=>make('circle',{cx:samples.length===1?300:16+i*568/(samples.length-1),cy:98-(s[key]-min)/(max-min)*84,r:3,fill:color}));
 }
}
function readSample(){const c=config();state.attempts++;const [kind,message]=reason(c),stamp=new Date().toLocaleTimeString();
 let fail=kind==='unsafe'||kind==='error';
 if(c.pullup==='no' && !fail) fail=state.attempts%2===1;
 if(fail){state.failures++;setText('sample-state',kind==='unsafe'?'Unsafe wiring blocked':'Read failed');
  const stage=kind==='unsafe'?'No GPIO transaction is attempted.':Number(c.interval)<2 && kind==='error'?'The prior conversion may not be ready; no fresh frame is accepted.':c.pullup==='no' && kind==='warning'?'DATA rises unreliably; the simulated checksum does not match.':'No complete 40-bit response reaches GPIO4.';
  setTrace(['Host checks circuit and interval.',stage,'Discard this attempt. Keep the last valid values, if any.']);
  log(`[${stamp}] attempt ${state.attempts}: ${kind==='unsafe'?'BLOCKED':'ERROR'} — ${message}`);
  state.events.push({attempt:state.attempts,time:stamp,result:'failed',reason:message});
 } else {
  const base=presets[c.room],off=sampleOffsets[(state.successes)%sampleOffsets.length];
  let t=base[0]+off[0],h=base[1]+off[1];if(c.sensor==='DHT11'){t=Math.round(t);h=Math.round(h);}
  t=Number(t.toFixed(1));h=Number(h.toFixed(1));const bytes=bytesFor(t,h,c.sensor);
  state.successes++;state.samples.push({attempt:state.attempts,time:stamp,sensor:c.sensor,room:c.room,temperature:t,humidity:h,source:'simulated'});
  setText('temperature',t.toFixed(1)+' °C');setText('humidity',h.toFixed(1)+' % RH');setText('sample-state','Simulated reading');
  setTrace([`Host starts a transaction on GPIO4.`,`${c.sensor} responds; example 40-bit frame: ${bytes.map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join(' ')} (hex).`,`Checksum: (${bytes.slice(0,4).join(' + ')}) mod 256 = ${bytes[4]}; received ${bytes[4]}.`,`Accept ${t.toFixed(1)} °C and ${h.toFixed(1)} % RH. Values are simulated.`]);
  log(`[${stamp}] attempt ${state.attempts}: ${c.sensor} → ${t.toFixed(1)} C | ${h.toFixed(1)} % RH [SIMULATED]`);
  state.events.push({attempt:state.attempts,time:stamp,result:'success',temperature:t,humidity:h,checksum:bytes[4]});
 }
 setText('successes',state.successes);setText('failures',state.failures);drawChart();
}
function stopPolling() {clearInterval(state.timer);state.timer=null;setText('auto','Start polling');$('auto').setAttribute('aria-pressed','false');}
function togglePolling(){if(state.timer){stopPolling();return;}const [kind]=reason(config());if(kind==='unsafe'||kind==='error'){readSample();return;}readSample();state.timer=setInterval(readSample,Number($('interval').value)*1000);setText('auto','Stop polling');$('auto').setAttribute('aria-pressed','true');}
function reset(){stopPolling();for(const [id,v] of Object.entries({sensor:'DHT22',room:'normal',power:'3v3',data:'gpio4',ground:'connected',pullup:'yes',interval:'2'}))$(id).value=v;
 Object.assign(state,{attempts:0,successes:0,failures:0,samples:[],events:[]});
 for(const [id,value] of [['temperature','—'],['humidity','—'],['successes','0'],['failures','0'],['sample-state','Waiting']])setText(id,value);
 setTrace(['Run a sample to inspect the sensor transaction.']);$('terminal').replaceChildren();log('lab@pi5:~$ waiting for a simulated read…');updateConfig();drawChart();}
function downloadResult(){const answers={pullup:$('answer-pullup').value,power:$('answer-power').value,checksum:$('answer-checksum').value};
 const payload={experiment:'01 · Raspberry Pi 5 DHT sensing',status:'draft',generatedAt:new Date().toISOString(),dataSource:'browser simulation; no physical readings',setup:config(),attempts:state.attempts,successes:state.successes,failures:state.failures,samples:state.samples,events:state.events,answers};
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='experiment-01-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
controls.forEach(k=>$(k).addEventListener(k==='interval'?'input':'change',()=>{if(state.timer)stopPolling();updateConfig();}));
$('sample').addEventListener('click',readSample);$('auto').addEventListener('click',togglePolling);$('reset').addEventListener('click',reset);$('export').addEventListener('click',downloadResult);
$('copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('code-view').textContent);setText('copy-code','Copied');setTimeout(()=>setText('copy-code','Copy code'),1800);}catch{setText('copy-code','Select code to copy');}});
reset();
