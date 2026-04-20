param(
  [Parameter(Mandatory = $true)]
  [string]$Source
)

$ErrorActionPreference = "Stop"

function Get-CellText {
  param($UsedRange, [int]$Row, [int]$Column)

  return ([string]$UsedRange.Cells.Item($Row, $Column).Text).Trim()
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $workbook = $excel.Workbooks.Open($Source, 0, $true)
  $worksheet = $workbook.Worksheets.Item(1)
  $used = $worksheet.UsedRange
  $rows = $used.Rows.Count

  $school = Get-CellText $used 1 1
  $records = New-Object System.Collections.Generic.List[object]

  for ($row = 7; $row -le $rows; $row++) {
    $account = Get-CellText $used $row 2
    $loginCode = Get-CellText $used $row 3
    $name = Get-CellText $used $row 4
    $dob = Get-CellText $used $row 5
    $className = Get-CellText $used $row 6

    if ($account -eq "" -and $loginCode -eq "" -and $dob -eq "") {
      continue
    }

    $records.Add([PSCustomObject]@{
      account = $account
      loginCode = $loginCode
      name = $name
      dob = $dob
      className = $className
    }) | Out-Null
  }

  [PSCustomObject]@{
    school = $school
    records = $records
  } | ConvertTo-Json -Depth 5
}
finally {
  if ($workbook) {
    $workbook.Close($false) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
  }

  if ($excel) {
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }

  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
