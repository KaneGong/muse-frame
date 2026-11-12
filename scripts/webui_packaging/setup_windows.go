package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
)

//go:embed payload.zip
var payload []byte

var version = "dev"

const launcher = "Muse Frame.exe"

func messageBox(message string, options uintptr) uintptr {
	text, _ := syscall.UTF16PtrFromString(message)
	title, _ := syscall.UTF16PtrFromString("Muse Frame Setup")
	box := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	result, _, _ := box.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), options)
	return result
}

func extractFile(file *zip.File, target string) error {
	if file.FileInfo().IsDir() {
		return os.MkdirAll(target, 0755)
	}
	if !file.Mode().IsRegular() {
		return fmt.Errorf("unsupported package file: %s", file.Name)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	input, err := file.Open()
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	return errors.Join(copyErr, output.Close())
}

func install() (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	if !filepath.IsAbs(local) {
		return "", errors.New("Windows Local AppData directory is unavailable")
	}
	root := filepath.Join(local, "Programs", "Muse Frame")
	digest := sha256.Sum256(payload)
	destination := filepath.Join(root, fmt.Sprintf("%s-%x", version, digest[:6]))
	app := filepath.Join(destination, launcher)
	if _, err := os.Stat(app); err == nil {
		return app, nil
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		return "", err
	}
	staging, err := os.MkdirTemp(root, ".muse-frame-install-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(staging)
	archive, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return "", err
	}
	for _, file := range archive.File {
		name, err := filepath.Localize(file.Name)
		if err != nil {
			return "", err
		}
		if err := extractFile(file, filepath.Join(staging, name)); err != nil {
			return "", err
		}
	}
	program := filepath.Join(staging, "Muse Frame")
	if _, err := os.Stat(filepath.Join(program, launcher)); err != nil {
		return "", err
	}
	if err := os.Rename(program, destination); err != nil {
		if _, existing := os.Stat(app); existing != nil {
			return "", err
		}
	}
	return app, nil
}

func shortcut(app string) error {
	var programs [syscall.MAX_PATH]uint16
	shell := syscall.NewLazyDLL("shell32.dll")
	result, _, _ := shell.NewProc("SHGetFolderPathW").Call(0, 0x8002, 0, 0, uintptr(unsafe.Pointer(&programs[0])))
	if err := hresult(result); err != nil {
		return err
	}
	filename := filepath.Join(syscall.UTF16ToString(programs[:]), "Muse Frame.lnk")
	return saveShortcut(app, filename)
}

func hresult(result uintptr) error {
	if int32(result) < 0 {
		return fmt.Errorf("Windows error 0x%08x", uint32(result))
	}
	return nil
}

type shellLink struct {
	vtable *struct {
		queryInterface, addRef, release                          uintptr
		getPath, getIDList, setIDList                            uintptr
		getDescription, setDescription                           uintptr
		getWorkingDirectory, setWorkingDirectory                 uintptr
		getArguments, setArguments, getHotkey, setHotkey         uintptr
		getShowCmd, setShowCmd, getIconLocation, setIconLocation uintptr
		setRelativePath, resolve, setPath                        uintptr
	}
}

type persistFile struct {
	vtable *struct {
		queryInterface, addRef, release uintptr
		getClassID, isDirty, load, save uintptr
	}
}

func saveShortcut(app, filename string) error {
	// COM initialization and every interface call must run on the same thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	ole := syscall.NewLazyDLL("ole32.dll")
	result, _, _ := ole.NewProc("CoInitializeEx").Call(0, 2)
	if err := hresult(result); err != nil {
		return err
	}
	defer ole.NewProc("CoUninitialize").Call()
	classID := syscall.GUID{Data1: 0x00021401, Data4: [8]byte{0xc0, 0, 0, 0, 0, 0, 0, 0x46}}
	linkID := syscall.GUID{Data1: 0x000214f9, Data4: classID.Data4}
	persistID := syscall.GUID{Data1: 0x0000010b, Data4: classID.Data4}
	var link *shellLink
	result, _, _ = ole.NewProc("CoCreateInstance").Call(uintptr(unsafe.Pointer(&classID)), 0, 1,
		uintptr(unsafe.Pointer(&linkID)), uintptr(unsafe.Pointer(&link)))
	if err := hresult(result); err != nil {
		return err
	}
	defer syscall.SyscallN(link.vtable.release, uintptr(unsafe.Pointer(link)))
	path, _ := syscall.UTF16PtrFromString(app)
	result, _, _ = syscall.SyscallN(link.vtable.setPath, uintptr(unsafe.Pointer(link)), uintptr(unsafe.Pointer(path)))
	if err := hresult(result); err != nil {
		return err
	}
	directory, _ := syscall.UTF16PtrFromString(filepath.Dir(app))
	result, _, _ = syscall.SyscallN(link.vtable.setWorkingDirectory, uintptr(unsafe.Pointer(link)), uintptr(unsafe.Pointer(directory)))
	if err := hresult(result); err != nil {
		return err
	}
	icon, _ := syscall.UTF16PtrFromString(filepath.Join(filepath.Dir(app), "app", "muse-frame.ico"))
	result, _, _ = syscall.SyscallN(link.vtable.setIconLocation, uintptr(unsafe.Pointer(link)), uintptr(unsafe.Pointer(icon)), 0)
	if err := hresult(result); err != nil {
		return err
	}
	var file *persistFile
	result, _, _ = syscall.SyscallN(link.vtable.queryInterface, uintptr(unsafe.Pointer(link)),
		uintptr(unsafe.Pointer(&persistID)), uintptr(unsafe.Pointer(&file)))
	if err := hresult(result); err != nil {
		return err
	}
	defer syscall.SyscallN(file.vtable.release, uintptr(unsafe.Pointer(file)))
	target, _ := syscall.UTF16PtrFromString(filename)
	result, _, _ = syscall.SyscallN(file.vtable.save, uintptr(unsafe.Pointer(file)), uintptr(unsafe.Pointer(target)), 1)
	return hresult(result)
}

func run(quiet bool, arguments []string) error {
	app, err := install()
	if err != nil {
		return err
	}
	if err := shortcut(app); err != nil {
		fmt.Fprintln(os.Stderr, err)
		if !quiet {
			messageBox("开始菜单快捷方式创建失败。你可以从这里启动：\nStart menu shortcut could not be created. You can open the app from:\n\n"+app, 0x30)
		}
	}
	return exec.Command(app, arguments...).Start()
}

func main() {
	quiet := len(os.Args) >= 2 && os.Args[1] == "--quiet"
	var arguments []string
	if quiet {
		arguments = os.Args[2:]
	}
	if !quiet && messageBox("将 Muse Frame 安装到当前 Windows 用户，并在浏览器中打开。\n\nInstall Muse Frame for this Windows user and open it in your browser.", 0x41) != 1 {
		return
	}
	if err := run(quiet, arguments); err != nil {
		fmt.Fprintln(os.Stderr, err)
		if !quiet {
			messageBox("Muse Frame 安装未完成。\nMuse Frame installation could not finish.\n\n"+err.Error(), 0x10)
		}
		os.Exit(1)
	}
}
