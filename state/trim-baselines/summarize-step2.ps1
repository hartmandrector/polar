$s2 = Get-Content c:\dev\polar\state\trim-baselines\step2-redistribute.json -Raw | ConvertFrom-Json

"`n=== STEP 2 ABSOLUTES (Wingsuit BASE, hip=0.30 leg=0.30, pitchT=0) ==="
$rows = $s2 | ForEach-Object {
  $segs=@{}; foreach($s in $_.segments){ $segs[$s.name]=$s.lift }
  $tor = $segs.torso; $leg = $segs.leg
  $ratio = if ($tor -ne 0) { [math]::Round($leg/$tor,2) } else { 0 }
  [PSCustomObject]@{
    V=$_.V; a=$_.alpha
    cl=[math]::Round($_.cl,3); cm=[math]::Round($_.cm,3); ld=[math]::Round($_.ld,2)
    pAcc=$_.readout.'r-pitch-accel'
    head=[math]::Round($segs.head,0)
    torso=[math]::Round($tor,0); leg=[math]::Round($leg,0); ratio=$ratio
    inner=[math]::Round($segs.r1+$segs.l1,0); outer=[math]::Round($segs.r2+$segs.l2,0)
  }
}
$rows | Format-Table -AutoSize | Out-String -Width 200

"`n=== TRIM α at each speed (linear interp where cm crosses 0) ==="
foreach ($V in @(25,35,45)) {
  $rows = $s2 | Where-Object { $_.V -eq $V } | Sort-Object alpha
  for ($i=0; $i -lt $rows.Count - 1; $i++) {
    $a = $rows[$i]; $b = $rows[$i+1]
    if (($a.cm -le 0 -and $b.cm -ge 0) -or ($a.cm -ge 0 -and $b.cm -le 0)) {
      $t = if (($b.cm - $a.cm) -ne 0) { -$a.cm / ($b.cm - $a.cm) } else { 0 }
      $alphaTrim = $a.alpha + $t * ($b.alpha - $a.alpha)
      $clTrim = $a.cl + $t * ($b.cl - $a.cl)
      $ldTrim = $a.ld + $t * ($b.ld - $a.ld)
      "V={0}  trim α = {1:F2}°   CL = {2:F3}   L/D = {3:F2}" -f $V, $alphaTrim, $clTrim, $ldTrim
      break
    }
  }
}

"`n=== Leg/Torso ratio at α=8 each V (representative trim band) ==="
$s2 | Where-Object { $_.alpha -eq 8 } | ForEach-Object {
  $segs=@{}; foreach($s in $_.segments){ $segs[$s.name]=$s.lift }
  "V={0}  torso={1:F0}N  leg={2:F0}N  ratio={3:F2}" -f $_.V, $segs.torso, $segs.leg, ($segs.leg/$segs.torso)
}
