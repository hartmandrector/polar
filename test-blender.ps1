$c = New-Object System.Net.Sockets.TcpClient("127.0.0.1", 9880)
$s = $c.GetStream()
$w = New-Object System.IO.StreamWriter($s)
$w.WriteLine('{"type":"get_scene_info","params":{}}')
$w.Flush()
Start-Sleep -Seconds 3
$c.ReceiveTimeout = 3000
$buf = New-Object byte[] 4096
try {
    $n = $s.Read($buf, 0, 4096)
    Write-Host "Got $n bytes:"
    Write-Host ([System.Text.Encoding]::UTF8.GetString($buf, 0, $n))
} catch {
    Write-Host "No response: $_"
}
$c.Close()
