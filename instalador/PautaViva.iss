; Instalador do Pauta Viva para Windows (Inno Setup 6.7 ou mais novo).
;
; Para gerar o instalador:
;   1. .venv\Scripts\python.exe instalador\gerar.py        (imagens e textos)
;   2. "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" instalador\PautaViva.iss
; Sai em dist\PautaViva-Setup-<versão>.exe (fora do Git: vai para as versões do GitHub).
;
; O que ele faz: copia o programa para a pasta da pessoa (não precisa de administrador), baixa o Python
; 3.12 oficial (pacote do NuGet, conferido pelo SHA-256), cria o ambiente, instala os componentes (com a
; versão para placa NVIDIA quando houver uma), cria os atalhos e registra o desinstalador em "Aplicativos".
; Observação: o Inno Setup pede licença comercial quando usado para vender software.

#define AppName "Pauta Viva"
#define AppVersion "0.1.0"
#define AppPublisher "Pauta Viva"
#define AppDirName "PautaViva"
#define PyVersion "3.12.10"
#define PySize "14515433"
#define PyHash "0eb85c2dfccccf1b17352de4c397f69194035b7d37149eacc16f1147d93de3b8"

[Setup]
AppId={{6C2D8B1E-4A7F-4E52-9B3C-1F8E5A7D2C90}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppComments=Transforma uma gravação em partitura, cifra, letra e tablatura. Ferramenta didática.
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Instalador do {#AppName}
VersionInfoProductName={#AppName}
DefaultDirName={localappdata}\Programs\{#AppDirName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=PautaViva-Setup-{#AppVersion}
SetupIconFile=..\web\pauta-viva.ico
UninstallDisplayIcon={app}\web\pauta-viva.ico
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
ArchiveExtraction=full
; a pasta cresce depois: ambiente Python, componentes e modelos baixados (até uns 10 GB com placa NVIDIA)
ExtraDiskSpaceRequired=6000000000
WizardStyle=modern dark
WizardImageFile=imagens\lateral-100.bmp,imagens\lateral-125.bmp,imagens\lateral-150.bmp,imagens\lateral-175.bmp,imagens\lateral-200.bmp
WizardSmallImageFile=imagens\icone-100.bmp,imagens\icone-125.bmp,imagens\icone-150.bmp,imagens\icone-175.bmp,imagens\icone-200.bmp
WizardImageAlphaFormat=defined
WizardImageStretch=no
WizardImageBackColor=black
; ordem das telas: boas-vindas, Sobre o programa (página própria, no [Code]), termo, pasta, atalho, instalação
DisableWelcomePage=no
LicenseFile=termo.rtf
ShowLanguageDialog=no
CloseApplications=no

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Messages]
ptbr.WelcomeLabel1=Bem-vindo ao {#AppName}
ptbr.WelcomeLabel2=O {#AppName} transforma uma gravação em partitura, cifra, letra e tablatura de violão, que andam junto com a música. É uma ferramenta 100% didática, feita para quem está aprendendo música.%n%nA instalação precisa de internet: ela baixa o Python e os componentes de inteligência artificial (de 1,5 a 4 GB, conforme o computador) e pode levar de 10 a 40 minutos.%n%nFeche os outros programas antes de continuar.
ptbr.WizardLicense=Termo de uso e responsabilidade
ptbr.LicenseLabel=Leia com atenção antes de continuar.
ptbr.LicenseLabel3=Para instalar o {#AppName}, você precisa aceitar este termo.
ptbr.LicenseAccepted=Eu &aceito o termo
ptbr.LicenseNotAccepted=Eu &não aceito o termo
ptbr.SelectDirLabel3=O {#AppName} será instalado nesta pasta (não precisa de permissão de administrador).
ptbr.SelectDirBrowseLabel=Para continuar, clique em Avançar. Para escolher outra pasta, clique em Procurar.
ptbr.WizardReady=Pronto para instalar
ptbr.ReadyLabel1=Tudo certo para instalar o {#AppName}. Deixe o computador ligado e conectado à internet até o fim.
ptbr.InstallingLabel=Aguarde enquanto o {#AppName} é instalado. A parte mais demorada é baixar os componentes de inteligência artificial.
ptbr.FinishedHeadingLabel=Tudo pronto!
ptbr.FinishedLabelNoIcons=O {#AppName} foi instalado.%n%nNa primeira música, ele ainda baixa os modelos de separação e de letra (uma vez só).
ptbr.FinishedLabel=O {#AppName} foi instalado. Para abrir, use o atalho na área de trabalho ou no menu Iniciar.%n%nNa primeira música, ele ainda baixa os modelos de separação e de letra (uma vez só).
ptbr.ClickFinish=Clique em Concluir para sair.
ptbr.ClickNext=Clique em Avançar para continuar ou em Cancelar para sair do instalador.
ptbr.ExitSetupMessage=A instalação não terminou. Se sair agora, o programa não será instalado.%n%nVocê pode abrir o instalador de novo outra hora para terminar.%n%nSair do instalador?

[Tasks]
Name: "desktopicon"; Description: "Criar um atalho na área de trabalho"; GroupDescription: "Atalhos:"

[Files]
Source: "..\app\*"; DestDir: "{app}\app"; Excludes: "__pycache__,*.pyc"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\tools\*"; DestDir: "{app}\tools"; Excludes: "__pycache__,*.pyc"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\data\gabarito\*"; DestDir: "{app}\data\gabarito"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\requirements.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\iniciar.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; DestName: "AVISOS DE TERCEIROS.md"; Flags: ignoreversion
Source: "termo.rtf"; DestDir: "{app}"; DestName: "TERMO DE USO.rtf"; Flags: ignoreversion
Source: "sobre.rtf"; Flags: dontcopy
; Python 3.12 oficial (pacote "python" do NuGet), baixado e conferido pelo SHA-256; só na primeira vez.
; É extraído no [Code] (InstalarComponentes): a extração automática de arquivo baixado não entra nas subpastas.
Source: "https://api.nuget.org/v3-flatcontainer/python/{#PyVersion}/python.{#PyVersion}.nupkg"; DestName: "python.zip"; DestDir: "{tmp}"; ExternalSize: {#PySize}; Hash: "{#PyHash}"; Flags: external download ignoreversion; Check: PrecisaDoPython

[Dirs]
Name: "{app}\data\songs"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\web\pauta-viva.ico"; Comment: "Partitura, cifra, letra e tablatura andando junto com a música"; Flags: runminimized
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\web\pauta-viva.ico"; Comment: "Partitura, cifra, letra e tablatura andando junto com a música"; Flags: runminimized; Tasks: desktopicon

[Run]
Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; Description: "Abrir o {#AppName} agora"; Flags: postinstall nowait skipifsilent runminimized

[UninstallRun]
; fecha o programa, se estiver aberto (o Python dele segura os arquivos)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Get-Process python,pythonw -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -like '{app}\*' } | Stop-Process -Force"""; Flags: runhidden; RunOnceId: "FecharPrograma"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.venv"
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\web"
Type: filesandordirs; Name: "{app}\tools"
Type: filesandordirs; Name: "{app}\data\models"
Type: filesandordirs; Name: "{app}\data\gabarito"
Type: files; Name: "{app}\data\config.json"
Type: files; Name: "{app}\instalacao.log"

[Code]
var
  LogPath: String;

{ "Sobre o programa" logo depois das boas-vindas e antes do termo (a página de informação do Inno
  só pode vir depois do termo) }
procedure InitializeWizard;
var
  Sobre: AnsiString;
begin
  ExtractTemporaryFile('sobre.rtf');
  LoadStringFromFile(ExpandConstant('{tmp}\sobre.rtf'), Sobre);
  CreateOutputMsgMemoPage(wpWelcome, 'Sobre o programa',
    'Para que serve, o que precisa de internet e os requisitos do computador.',
    'Quando estiver pronto, clique em Avançar.', Sobre);
end;

function PrecisaDoPython: Boolean;
begin
  Result := not FileExists(ExpandConstant('{app}\python\tools\python.exe'));
end;

function TemNvidia: Boolean;
begin
  Result := FileExists(ExpandConstant('{sys}\nvidia-smi.exe'));
end;

{ fecha o programa antes de atualizar (o Python dele segura os arquivos) }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -Command "Get-Process python,pythonw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' +
       ExpandConstant('{app}') + '\*'' } | Stop-Process -Force"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;

{ roda um comando escondido, guardando tudo no instalacao.log }
function Rodar(const Exe, Params: String): Boolean;
var
  Code: Integer;
begin
  Log('Rodando: ' + Exe + ' ' + Params);
  Result := Exec(ExpandConstant('{cmd}'), '/S /C ""' + Exe + '" ' + Params + ' >> "' + LogPath + '" 2>&1"',
                 ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  if not Result then
    Log(Format('Falhou (código %d).', [Code]));
end;

{ um passo da instalação dos componentes, com a mensagem na tela e a chance de tentar de novo }
function Passo(const Titulo, Detalhe, Exe, Params: String): Boolean;
begin
  WizardForm.StatusLabel.Caption := Titulo;
  WizardForm.FilenameLabel.Caption := Detalhe;
  repeat
    Result := Rodar(Exe, Params);
    if Result then
      Exit;
  until SuppressibleMsgBox('Não deu certo: ' + Titulo + #13#10#13#10 +
        'Confira a conexão com a internet e clique em Repetir.' + #13#10 +
        'Os detalhes ficam em ' + LogPath, mbError, MB_RETRYCANCEL, IDCANCEL) <> IDRETRY;
end;

procedure InstalarComponentes;
var
  Py, Venv, VenvPy: String;
  Ok: Boolean;
begin
  LogPath := ExpandConstant('{app}\instalacao.log');
  Py := ExpandConstant('{app}\python\tools\python.exe');
  Venv := ExpandConstant('{app}\.venv');
  VenvPy := Venv + '\Scripts\python.exe';
  WizardForm.ProgressGauge.Style := npbstMarquee;
  Ok := True;
  if PrecisaDoPython then
  begin
    WizardForm.StatusLabel.Caption := 'Instalando o Python {#PyVersion} do programa...';
    WizardForm.FilenameLabel.Caption := ExpandConstant('{app}\python');
    try
      ExtractArchive(ExpandConstant('{tmp}\python.zip'), ExpandConstant('{app}\python'), '', True, nil);
    except
      Log('Não consegui extrair o Python: ' + GetExceptionMessage);
    end;
    Ok := not PrecisaDoPython;
  end;
  if Ok and not FileExists(VenvPy) then
    Ok := Passo('Preparando o ambiente do programa...', 'Python {#PyVersion} só para o {#AppName}', Py, '-m venv "' + Venv + '"');
  if Ok then
    Ok := Passo('Atualizando o instalador de pacotes...', 'pip', VenvPy, '-m pip install --upgrade pip --disable-pip-version-check');
  if Ok and TemNvidia then
  begin
    Ok := Passo('Placa de vídeo NVIDIA encontrada: baixando a versão que usa a placa...',
                'PyTorch com CUDA, cerca de 2,5 GB. Pode levar de 10 a 30 minutos.',
                VenvPy, '-m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124');
    if Ok then
      Ok := Passo('Baixando as bibliotecas da placa de vídeo...', 'cuBLAS e cuDNN da NVIDIA, cerca de 1 GB',
                  VenvPy, '-m pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"');
  end;
  if Ok then
    Ok := Passo('Baixando os componentes de áudio, partitura e inteligência artificial...',
                'Separação dos instrumentos, acordes, partitura e letra. Pode levar de 5 a 20 minutos.',
                VenvPy, '-m pip install -r "' + ExpandConstant('{app}\requirements.txt') + '"');
  WizardForm.ProgressGauge.Style := npbstNormal;
  if Ok then
  begin
    { o iniciar.bat vê que está tudo instalado e não cria outro atalho }
    FileCopy(ExpandConstant('{app}\requirements.txt'), Venv + '\pauta_requirements.txt', False);
    SaveStringToFile(Venv + '\atalho_criado', '', False);
  end
  else
    SuppressibleMsgBox('A instalação dos componentes não terminou.' + #13#10#13#10 +
      'Abra o {#AppName} pelo atalho: ele continua de onde parou e mostra o que aconteceu.',
      mbInformation, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    InstalarComponentes;
end;

{ ao desinstalar, pergunta se apaga também as músicas transcritas }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Songs: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    Songs := ExpandConstant('{app}\data\songs');
    if DirExists(Songs) then
      if SuppressibleMsgBox('Apagar também as músicas que você transcreveu (partituras, partes separadas e análises)?',
           mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES then
        DelTree(ExpandConstant('{app}'), True, True, True);
  end;
end;
