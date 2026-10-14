@echo off
setlocal
cd /d "%~dp0"
title soundStudy
set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"
set "LOG=%~dp0instalacao.log"

rem Se o soundStudy ja estiver aberto, so abre o navegador.
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:8765/api/stages -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" http://127.0.0.1:8765
  goto :eof
)

echo.
echo    ================================================
echo      soundStudy
echo    ================================================
echo.

if exist ".venv\Scripts\python.exe" goto :componentes

rem ---------------------------------------------------------------- 1. Python
echo    [1/4] Procurando o Python 3.12...
set "PY="
rem o Python que o instalador baixou fica na pasta do programa
if exist "%~dp0python\tools\python.exe" set "PY=%~dp0python\tools\python.exe"
if defined PY goto :ambiente
for /f "delims=" %%p in ('py -3.12 -c "import sys; print(sys.executable)" 2^>nul') do set "PY=%%p"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if defined PY goto :ambiente
echo          O Python 3.12 nao esta instalado neste computador.
choice /c SN /m "          Instalar agora (gratis, pelo instalador oficial do Windows)"
if errorlevel 2 goto :semPython
winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY goto :semPython

rem ---------------------------------------------------------------- 2. ambiente
:ambiente
echo    [2/4] Criando o ambiente do soundStudy...
"%PY%" -m venv .venv >>"%LOG%" 2>&1 || goto :erro
".venv\Scripts\python.exe" -m pip install --upgrade pip >>"%LOG%" 2>&1 || goto :erro

rem ---------------------------------------------------------------- 3. componentes
:componentes
rem Placa de video NVIDIA: instala o PyTorch que usa a placa (CUDA) e as bibliotecas da letra na placa.
where nvidia-smi >nul 2>nul
if errorlevel 1 goto :pacotes
".venv\Scripts\python.exe" -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)" >nul 2>nul
if not errorlevel 1 goto :pacotes
echo    [3/4] Placa de video NVIDIA encontrada: instalando a versao que usa a placa (cerca de 2,5 GB)...
".venv\Scripts\python.exe" -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124 >>"%LOG%" 2>&1 || goto :erro
".venv\Scripts\python.exe" -m pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*" >>"%LOG%" 2>&1 || goto :erro

:pacotes
rem Instala o que faltar quando o projeto ganha pecas novas (requirements.txt mudou).
fc /b requirements.txt ".venv\pauta_requirements.txt" >nul 2>nul
if not errorlevel 1 goto :atalho
echo    [3/4] Instalando os componentes: separacao, partitura, acordes e letra. Pode levar alguns minutos...
".venv\Scripts\python.exe" -m pip install -r requirements.txt >>"%LOG%" 2>&1 || goto :erro
copy /y requirements.txt ".venv\pauta_requirements.txt" >nul

rem ---------------------------------------------------------------- 4. atalho
:atalho
if exist ".venv\atalho_criado" goto :rodar
echo    [4/4] Criando o atalho "soundStudy" na area de trabalho...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = [Environment]::GetFolderPath('Desktop'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'soundStudy.lnk')); $s.TargetPath = '%~dp0iniciar.bat'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0web\soundstudy.ico'; $s.Description = 'soundStudy'; $s.WindowStyle = 7; $s.Save()" >>"%LOG%" 2>&1
type nul > ".venv\atalho_criado"

:rodar
set "PAUTA_ABRIR_NAVEGADOR=1"
echo.
echo    soundStudy rodando em http://127.0.0.1:8765
echo    Deixe esta janela aberta enquanto usa. Para fechar, feche esta janela.
echo.
".venv\Scripts\python.exe" -m uvicorn app.server:app --host 127.0.0.1 --port 8765 --log-level warning
goto :eof

:semPython
echo.
echo    Sem o Python 3.12 o soundStudy nao funciona.
echo    Baixe em https://www.python.org/downloads/ (marque "Add python.exe to PATH")
echo    e abra este arquivo de novo.
echo.
pause
goto :eof

:erro
echo.
echo    Algo deu errado. Ultimas linhas do registro (instalacao.log):
echo    ------------------------------------------------------------
powershell -NoProfile -Command "Get-Content -Path '%LOG%' -Tail 15"
echo.
echo    Confira a internet e tente de novo. Se continuar, mande o arquivo instalacao.log.
pause