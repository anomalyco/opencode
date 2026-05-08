# In the current ConEmu version TrueColor is available
# only in the lower part of console buffer

$h = [Console]::WindowHeight
$w = [Console]::BufferWidth
$y = ([Console]::BufferHeight-$h)

# Clean console contents (this will clean TrueColor attributes)
Write-Host (([char]27)+"[32766S")
# Apply default powershell console attributes
cls

# Ensure that we are in the bottom of the buffer
try{
  [Console]::SetWindowPosition(0,$y)
  [Console]::SetCursorPosition(0,$y)
}catch{
  Write-Host (([char]27)+"[32766H")
}

# Header
$title = " Printing 24bit gradient with ANSI sequences using powershell"
Write-Host (([char]27)+"[m"+$title)

# Run cycles. Use {ESC [ 48 ; 2 ; R ; G ; B m} to set background
# RGB color of the next printing character (space in this example)
$l = 0
$h -= 3
$w -= 2
while ($l -lt $h) {
  $b = [int]($l*255/$h)
  $c = 0
  Write-Host -NoNewLine (([char]27)+"[m ")
  while ($c -lt $w) {
    $r = [int]($c*255/$w)
    Write-Host -NoNewLine (([char]27)+"[48;2;"+$r+";255;"+$b+"m ")
    $c++
  }
  Write-Host (([char]27)+"[m ")
  $l++
}

# Footer
Write-Host " Gradient done"
