$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dungeonPath = Join-Path $root 'dungeon-001.md'
$templatePath = Join-Path $root 'session-log.template.csv'
$localLogPath = Join-Path $root 'session-log.csv'
$readmePath = Join-Path $root 'README.md'

function Decode-Utf8 {
  param([Parameter(Mandatory)] [string] $Base64)

  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Base64))
}

function Assert-Equal {
  param(
    [Parameter(Mandatory)] $Actual,
    [Parameter(Mandatory)] $Expected,
    [Parameter(Mandatory)] [string] $Label
  )

  if ($Actual -ne $Expected) {
    throw "${Label}: expected '$Expected', got '$Actual'"
  }
}

function Assert-True {
  param(
    [Parameter(Mandatory)] [bool] $Condition,
    [Parameter(Mandatory)] [string] $Label
  )

  if (-not $Condition) {
    throw $Label
  }
}

$text = Get-Content -LiteralPath $dungeonPath -Raw -Encoding utf8
$stageMatches = [regex]::Matches($text, '(?m)^## Stage (\d+)')
Assert-Equal $stageMatches.Count 10 'stage count'

$stageNumbers = @($stageMatches | ForEach-Object { [int] $_.Groups[1].Value })
Assert-Equal ($stageNumbers -join ',') ((1..10) -join ',') 'stage sequence'

$exchangeMatches = [regex]::Matches($text, '(?m)^### Exchange [12]')
Assert-Equal $exchangeMatches.Count 2 'boss exchange count'

$cardMatches = [regex]::Matches(
  $text,
  '(?s)<!-- PLAYER_CARD ([^ ]+) -->\s*(.*?)\s*<!-- /PLAYER_CARD -->'
)
Assert-Equal $cardMatches.Count 11 'player card count'

$choiceTotal = 0
foreach ($card in $cardMatches) {
  $cardId = $card.Groups[1].Value
  $body = $card.Groups[2].Value
  $choiceCount = [regex]::Matches($body, '(?m)^- \*\*[ABC] ').Count
  Assert-Equal $choiceCount 3 "choice count for $cardId"
  Assert-True ($body.Length -le 700) "player card $cardId exceeds 700 characters ($($body.Length))"
  $choiceTotal += $choiceCount
}
Assert-Equal $choiceTotal 33 'total player choice count'

$requiredTerms = @(
  '0KTRltC30LjRh9C90LAg0YHQuNC70LA=',
  '0JzQsNCz0ZbRh9C90LAg0YHQuNC70LA=',
  '0KHQv9GA0LjRgtC90ZbRgdGC0Yw=',
  '0JbQuNCy0YPRh9GW0YHRgtGM',
  'Neutral'
)
foreach ($encodedTerm in $requiredTerms) {
  $term = if ($encodedTerm -eq 'Neutral') { $encodedTerm } else { Decode-Utf8 $encodedTerm }
  Assert-True $text.Contains($term) "missing required route term: $encodedTerm"
}

$combatTerm = Decode-Utf8 '0LHRltC5Og=='
Assert-Equal ([regex]::Matches($text, [regex]::Escape($combatTerm)).Count) 2 'declared pure-combat stage count'
Assert-True $text.Contains((Decode-Utf8 '0YHQvtGG0ZbQsNC70YzQvdC40Lk=')) 'missing social encounter declaration'
Assert-True $text.Contains((Decode-Utf8 '0LTQvtGB0LvRltC00LbQtdC90L3Rjw==')) 'missing research encounter declaration'
Assert-True $text.Contains((Decode-Utf8 '0JzQsNC60YHQuNC80YPQvCDQtNC+INC30LDQstC10YDRiNC10L3QvdGPIFN0YWdlIDU6IGA2MCBYUGA=')) 'missing early XP budget'
Assert-True $text.Contains((Decode-Utf8 '0LzQsNC60YHQuNC80YPQvCDQt9CwINC/0L7QstC90YMg0L/QtdGA0LXQvNC+0LPRgzogYDEwMCBYUGA=')) 'missing full XP budget'

$maxName = [regex]::Escape((Decode-Utf8 '0JzQsNC60YE='))
$forbiddenPatterns = @(
  "(?i)(?<!\p{L})$maxName(?!\p{L})",
  [regex]::Escape((Decode-Utf8 '0YfQvtGA0L3QtSDQutGW0LvRjNGG0LU=')),
  [regex]::Escape((Decode-Utf8 '0LzQsNCz0ZbRjyDQv9C70L7RgtGW'))
)
foreach ($pattern in $forbiddenPatterns) {
  Assert-Equal ([regex]::Matches($text, $pattern).Count) 0 "forbidden lore pattern $pattern"
}

$templateHeader = Get-Content -LiteralPath $templatePath -Encoding utf8 -TotalCount 1
$localHeader = Get-Content -LiteralPath $localLogPath -Encoding utf8 -TotalCount 1
Assert-Equal $localHeader $templateHeader 'local session-log header'

$readme = Get-Content -LiteralPath $readmePath -Raw -Encoding utf8
Assert-True $readme.Contains('first_choice_messages=2') 'README does not pin the two-message first-choice gate'
Assert-True $readme.Contains((Decode-Utf8 '0LLRltC00YDQtdC00LDQs9GD0LnRgtC1INGC0YMg0YHQsNC80YMg0LrQsNGA0YLQutGD')) 'README does not emulate edited Telegram cards'
Assert-True $readme.Contains((Decode-Utf8 '0L3QtSDQtNC+0LLQvtC00LjRgtGMINC00L7QstCz0L7RgdGC0YDQvtC60L7QstC1INGD0YLRgNC40LzQsNC90L3Rjw==')) 'README does not state concierge-test limits'

Write-Output 'OK: 10 stages, 11 cards, 33 choices, all player cards <=700 chars.'
