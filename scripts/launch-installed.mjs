import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readInstallation, componentsDirectory } from './install-state.mjs';
try {
  const target = `${process.platform}-${process.arch}`;
  const installation = await readInstallation(componentsDirectory(), target);
  const child = spawn(process.execPath,[join(installation.app,'scripts/start-local-web.mjs')],{
    cwd:installation.app,stdio:'inherit',env:{...process.env,SC_LOCAL_RESOURCE_ROOT:join(installation.app,'runtime')}
  });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code ?? 1;});
} catch (error) { console.error(`无法启动：${error.message}\n请运行“安装 SmartCharacter”修复组件；用户数据不会被清空。`); process.exitCode=1; }
