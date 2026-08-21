[CmdletBinding()]
param(
  [switch]$StopPostgresAfter
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envFile = Join-Path $projectRoot ".env"
$composeFile = Join-Path $projectRoot "infra\docker-compose.postgres.yml"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Arquivo .env não encontrado em $projectRoot. Copie .env.example e preencha somente o ambiente local."
}

Push-Location $projectRoot
try {
  Write-Host "[1/5] Verificando o Docker local..." -ForegroundColor Cyan
  Invoke-Checked -FailureMessage "O Docker Desktop não está pronto. Aguarde aparecer Engine running e tente novamente." -Command {
    docker info --format "Docker {{.ServerVersion}} - {{.OperatingSystem}}"
  }

  Write-Host "[2/5] Subindo somente o PostgreSQL local..." -ForegroundColor Cyan
  Invoke-Checked -FailureMessage "Não foi possível iniciar o PostgreSQL local." -Command {
    docker compose --env-file $envFile -f $composeFile up -d postgres
  }

  Write-Host "[3/5] Aguardando o banco ficar saudável..." -ForegroundColor Cyan
  $databaseReady = $false
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    docker compose --env-file $envFile -f $composeFile exec -T postgres pg_isready *> $null
    if ($LASTEXITCODE -eq 0) {
      $databaseReady = $true
      break
    }
    Start-Sleep -Seconds 2
  }

  if (-not $databaseReady) {
    throw "O PostgreSQL não ficou saudável dentro de 60 segundos. Consulte: docker compose --env-file .env -f infra/docker-compose.postgres.yml logs postgres"
  }

  Write-Host "[4/5] Aplicando as migrações no banco local..." -ForegroundColor Cyan
  Invoke-Checked -FailureMessage "A migração local falhou." -Command {
    node "--env-file=$envFile" "packages/db/node_modules/tsx/dist/cli.mjs" "packages/db/src/migrate.ts"
  }

  Write-Host "[5/5] Executando os testes de integração do banco..." -ForegroundColor Cyan
  Push-Location (Join-Path $projectRoot "packages\db")
  try {
    Invoke-Checked -FailureMessage "Os testes de integração do banco falharam." -Command {
      node "--env-file=$envFile" "node_modules/vitest/vitest.mjs" run
    }
  }
  finally {
    Pop-Location
  }

  Write-Host "Validação local do discador concluída com sucesso. Nenhum deploy foi realizado." -ForegroundColor Green
}
finally {
  if ($StopPostgresAfter) {
    docker compose --env-file $envFile -f $composeFile stop postgres
  }
  Pop-Location
}
