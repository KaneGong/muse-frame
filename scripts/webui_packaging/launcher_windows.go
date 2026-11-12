package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

const createNoWindow = 0x08000000

func launch() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Dir(executable)
	python := filepath.Join(root, "runtime", "python.exe")
	entry := filepath.Join(root, "design", "muse-frame-04", "beta.py")
	arguments := append([]string{"-B", "-X", "utf8", entry}, os.Args[1:]...)
	command := exec.Command(python, arguments...)
	command.Dir = root
	command.Env = append(os.Environ(), "MUSE_FRAME_PACKAGED=1")
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
	return command.Run()
}

func main() {
	if err := launch(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		if len(os.Args) == 1 {
			message, _ := syscall.UTF16PtrFromString("请解压完整文件夹后再启动 Muse Frame。\nExtract the full folder before starting Muse Frame.\n\n" + err.Error())
			title, _ := syscall.UTF16PtrFromString("Muse Frame")
			messageBox := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
			messageBox.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x10)
		}
		os.Exit(1)
	}
}
