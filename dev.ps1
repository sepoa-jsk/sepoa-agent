<#
.SYNOPSIS
  사내 업무 플랫폼 개발 환경 기동 — platform/ports.json 의 활성 업무·내부 서비스·게이트웨이를 각각 새 PowerShell 창으로 띄운다.

.EXAMPLE
  .\dev.ps1                  # 전체
  .\dev.ps1 -Only quote2     # 일부 (쉼표로 여러 개: -Only quote,quote2). 게이트웨이는 항상 기동
  .\dev.ps1 -List            # 목록만 출력
  .\dev.ps1 -NoGateway       # 게이트웨이 제외

  각 창을 닫거나 Ctrl+C 하면 그 앱만 멈춘다. 다른 앱은 영향 없다.
#>
param(
  [string[]]$Only = @(),
  [switch]$List,
  [switch]$NoGateway
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$cfg = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'platform\ports.json') | ConvertFrom-Json

$targets = @()
foreach ($a in $cfg.apps)     { $targets += [pscustomobject]@{ Id=$a.id; Name=$a.name; Port=$a.port; Dir=$a.dir; Start=$a.start; Enabled=($a.enabled -ne $false); Kind='업무' } }
foreach ($a in $cfg.internal) { $targets += [pscustomobject]@{ Id=$a.id; Name=$a.name; Port=$a.port; Dir=$a.dir; Start=$a.start; Enabled=($a.enabled -ne $false); Kind='내부' } }

if ($Only.Count -gt 0) {
  $want = $Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $unknown = $want | Where-Object { $_ -notin $targets.Id }
  if ($unknown) { throw "ports.json 에 없는 id: $($unknown -join ', ')  (가능: $($targets.Id -join ', '))" }
  $targets = $targets | Where-Object { $_.Id -in $want }
}

$targets | Format-Table Kind, Id, Name, Port, Enabled, Dir -AutoSize
if ($List) { return }

function Test-PortInUse([int]$port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $port); $c.Close(); return $true } catch { return $false }
}

function Start-App($id, $title, $dir, $cmd, $port) {
  $full = Join-Path $Root $dir
  if (-not (Test-Path $full)) { Write-Warning "[$id] 폴더 없음: $full — 건너뜀"; return }
  if ($port -and (Test-PortInUse $port)) { Write-Warning "[$id] 포트 $port 사용 중 — 이미 떠 있는 것으로 보고 건너뜀"; return }
  $inner = "`$Host.UI.RawUI.WindowTitle = '$title :$port'; Set-Location -LiteralPath '$full'; $cmd"
  Start-Process powershell -ArgumentList @('-NoExit', '-Command', $inner) | Out-Null
  Write-Host ("  기동  {0,-10} :{1,-5} {2}" -f $id, $port, $dir)
}

foreach ($t in $targets) {
  if (-not $t.Enabled) { Write-Host ("  보류  {0,-10} (enabled:false)" -f $t.Id); continue }
  Start-App $t.Id $t.Name $t.Dir $t.Start $t.Port
}

if (-not $NoGateway) {
  Start-App 'gateway' '게이트웨이' 'platform\gateway' 'node server.js' $cfg.gateway.port
  Write-Host "`n  → http://localhost:$($cfg.gateway.port)/  (Java 앱은 기동에 수십 초 걸린다)"
}
