import { readFile } from 'node:fs/promises';
export async function inspectNative(path) {
 const b=await readFile(path);
 if(b.readUInt32LE(0)===0xfeedfacf){const cpu=b.readUInt32LE(4);return {format:'Mach-O',arch:cpu===0x0100000c?'arm64':cpu===0x01000007?'x64':'unknown',imports:[]};}
 if(b.toString('ascii',0,2)!=='MZ')throw new Error('不是目标原生二进制');
 const pe=b.readUInt32LE(0x3c);if(b.toString('ascii',pe,pe+4)!=='PE\u0000\u0000')throw new Error('PE 头无效');
 const machine=b.readUInt16LE(pe+4),sections=b.readUInt16LE(pe+6),optSize=b.readUInt16LE(pe+20),opt=pe+24;
 const is64=b.readUInt16LE(opt)===0x20b,dir=opt+(is64?112:96),sec=opt+optSize;
 const offset=rva=>{for(let i=0;i<sections;i++){const s=sec+i*40,vaddr=b.readUInt32LE(s+12),size=Math.max(b.readUInt32LE(s+8),b.readUInt32LE(s+16));if(rva>=vaddr&&rva<vaddr+size)return b.readUInt32LE(s+20)+(rva-vaddr);}throw new Error('PE RVA 无效');};
 const imports=[],rva=b.readUInt32LE(dir+8);
 if(rva){let p=offset(rva);for(let i=0;i<512;i++,p+=20){const name=b.readUInt32LE(p+12);if(!name)break;const n=offset(name),end=b.indexOf(0,n);imports.push(b.toString('ascii',n,end));}}
 return {format:'PE',arch:machine===0x8664?'x64':machine===0xaa64?'arm64':'unknown',imports};
}
