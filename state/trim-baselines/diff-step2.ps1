$base = Get-Content "c:\dev\polar\state\trim-baselines\baseline-pre-retune.json" -Raw | ConvertFrom-Json
$s2   = Get-Content "c:\dev\polar\state\trim-baselines\step2-redistribute.json" -Raw | ConvertFrom-Json

"`n=== STEP 2 ABSOLUTES ==="
$s2 | ForEach-Object {
  $segs=@{}; foreach($s in $_.segments){ $segs[$s.name]=$s.lift }
  $ratio = if ($segs.torso -ne 0) { [math]::Round($segs.leg/$segs.torso,2) } else { 0 }
  [PSCustomObject]@{
    V=$_.V; a=$_.alpha
    cl=[math]::Round($_.cl,3); cm=[math]::Round($_.cm,3); ld=[math]::Round($_.ld,2)
    pAcc=$_.readout.'r-pitch-accel'
    torso=[math]::Round($segs.torso,0); leg=[math]::Round($segs.leg,0); ratio=$ratio
    inner=[math]::Round($segs.r1+$segs.l1,0); outer=[math]::Round($segs.r2+$segs.l2,0)
  }
} | Format-Table -AutoSize | Out-String -Width 200

"`n=== DELTA vs BASELINE ==="
$diff = for ($i=0; $i -lt $base.Count; $i++) {
  $b = $base[$i]; $s = $s2[$i]
  $bSeg=@{}; foreach($x in $b.segments){ $bSeg[$x.name]=$x.lift }
  $sSeg=@{}; foreach($x in $s.segments){ $sSeg[$x.name]=$x.lift }
  $bRatio = if ($bSeg.torso -ne 0) { $bSeg.leg/$bSeg.torso } else { 0 }
  $sRatio = if ($sSeg.torso -ne 0) { $sSeg.leg/$sSeg.torso } else { 0 }
  [PSCustomObject]@{
    V=$b.V; a=$b.alpha
    dCL=[math]::Round($s.cl - $b.cl,3)
    dCM=[math]::Round($s.cm - $b.cm,3)
    dLD=[math]::Round($s.ld - $b.ld,2)
    dTorso=[math]::Round($sSeg.torso - $bSeg.torso,0)
    dLeg=[math]::Round($sSeg.leg - $bSeg.leg,0)
    rBase=[math]::Round($bRatio,2)
    rStep2=[math]::Round($sRatio,2)
  }
}
$diff | Format-Table -AutoSize | Out-String -Width 200
