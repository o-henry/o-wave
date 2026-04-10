// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitservice

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
)

const defaultTimeout = 5 * time.Second
const maxReviewContentBytes = 256 * 1024

type CodeReviewFile struct {
	Path         string `json:"path"`
	PreviousPath string `json:"previouspath,omitempty"`
	Status       string `json:"status"`
	Added        int    `json:"added"`
	Removed      int    `json:"removed"`
	Binary       bool   `json:"binary,omitempty"`
	TooLarge     bool   `json:"toolarge,omitempty"`
	Original     string `json:"original,omitempty"`
	Modified     string `json:"modified,omitempty"`
}

type CodeReviewData struct {
	RepoRoot    string            `json:"reporoot"`
	Branch      string            `json:"branch"`
	ChangeScope string            `json:"changescope"`
	FileCount   int               `json:"filecount"`
	Added       int               `json:"added"`
	Removed     int               `json:"removed"`
	Files       []*CodeReviewFile `json:"files"`
}

type GitService struct{}

func (svc *GitService) GetCodeReview_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "get a local git code review snapshot for uncommitted changes",
		ArgNames: []string{"path"},
	}
}

func (svc *GitService) GetCodeReview(path string) (*CodeReviewData, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancelFn()

	repoRoot, err := resolveRepoRoot(ctx, path)
	if err != nil {
		return nil, err
	}
	branch, err := runGitTrim(ctx, repoRoot, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return nil, err
	}
	statusOutput, err := runGitTrim(ctx, repoRoot, "status", "--porcelain=v1", "--branch", "--untracked-files=all")
	if err != nil {
		return nil, err
	}
	files, err := parseChangedFiles(ctx, repoRoot, statusOutput)
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})
	review := &CodeReviewData{
		RepoRoot:    filepath.ToSlash(repoRoot),
		Branch:      branch,
		ChangeScope: "Uncommitted changes",
		FileCount:   len(files),
		Files:       files,
	}
	for _, file := range files {
		review.Added += file.Added
		review.Removed += file.Removed
	}
	return review, nil
}

func resolveRepoRoot(ctx context.Context, path string) (string, error) {
	if path == "" {
		path = "."
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return "", err
	}
	workingDir := absPath
	if !info.IsDir() {
		workingDir = filepath.Dir(absPath)
	}
	repoRoot, err := runGitTrim(ctx, workingDir, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("not a git repository: %w", err)
	}
	return repoRoot, nil
}

func parseChangedFiles(ctx context.Context, repoRoot string, statusOutput string) ([]*CodeReviewFile, error) {
	lines := strings.Split(statusOutput, "\n")
	files := make([]*CodeReviewFile, 0)
	for _, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "##") {
			continue
		}
		if len(rawLine) < 4 {
			continue
		}
		xy := rawLine[:2]
		pathPart := strings.TrimSpace(rawLine[3:])
		previousPath := ""
		currentPath := pathPart
		if strings.Contains(pathPart, " -> ") {
			parts := strings.SplitN(pathPart, " -> ", 2)
			previousPath = cleanPorcelainPath(parts[0])
			currentPath = cleanPorcelainPath(parts[1])
		} else {
			currentPath = cleanPorcelainPath(pathPart)
		}
		status := summarizeStatus(xy)
		file, err := buildReviewFile(ctx, repoRoot, currentPath, previousPath, status)
		if err != nil {
			return nil, err
		}
		files = append(files, file)
	}
	return files, nil
}

func buildReviewFile(ctx context.Context, repoRoot, currentPath, previousPath, status string) (*CodeReviewFile, error) {
	currentPath = normalizeRepoPath(repoRoot, currentPath)
	previousPath = normalizeRepoPath(repoRoot, previousPath)
	revisionPath := currentPath
	if previousPath != "" {
		revisionPath = previousPath
	}
	originalBytes, _ := readGitRevision(ctx, repoRoot, revisionPath)
	modifiedBytes, _ := readWorkingTreeFile(repoRoot, currentPath)
	added, removed, binaryFromGit := getNumStat(ctx, repoRoot, currentPath, status, originalBytes, modifiedBytes)
	binary := binaryFromGit || isLikelyBinary(originalBytes) || isLikelyBinary(modifiedBytes)
	tooLarge := len(originalBytes) > maxReviewContentBytes || len(modifiedBytes) > maxReviewContentBytes
	file := &CodeReviewFile{
		Path:         filepath.ToSlash(currentPath),
		PreviousPath: filepath.ToSlash(previousPath),
		Status:       status,
		Added:        added,
		Removed:      removed,
		Binary:       binary,
		TooLarge:     tooLarge,
	}
	if !binary && !tooLarge {
		file.Original = string(originalBytes)
		file.Modified = string(modifiedBytes)
	}
	return file, nil
}

func summarizeStatus(xy string) string {
	switch {
	case xy == "??":
		return "untracked"
	case strings.Contains(xy, "R"):
		return "renamed"
	case strings.Contains(xy, "A"):
		return "added"
	case strings.Contains(xy, "D"):
		return "deleted"
	case strings.Contains(xy, "U"):
		return "conflicted"
	case strings.Contains(xy, "M"):
		return "modified"
	default:
		return "changed"
	}
}

func cleanPorcelainPath(path string) string {
	path = strings.TrimSpace(path)
	if unquoted, err := strconv.Unquote(path); err == nil {
		return unquoted
	}
	return path
}

func readGitRevision(ctx context.Context, repoRoot, repoPath string) ([]byte, error) {
	if repoPath == "" {
		return nil, nil
	}
	cmd := exec.CommandContext(ctx, "git", "-C", repoRoot, "show", "HEAD:"+filepath.ToSlash(repoPath))
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		return nil, nil
	}
	return stdout.Bytes(), nil
}

func readWorkingTreeFile(repoRoot, repoPath string) ([]byte, error) {
	if repoPath == "" {
		return nil, nil
	}
	fullPath := repoPath
	if !filepath.IsAbs(fullPath) {
		fullPath = filepath.Join(repoRoot, filepath.FromSlash(repoPath))
	}
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, nil
	}
	return data, nil
}

func getNumStat(ctx context.Context, repoRoot, repoPath, status string, originalBytes, modifiedBytes []byte) (int, int, bool) {
	repoPath = normalizeRepoPath(repoRoot, repoPath)
	if repoPath != "" {
		out, err := runGitTrim(ctx, repoRoot, "diff", "--numstat", "--find-renames", "HEAD", "--", repoPath)
		if err == nil && out != "" {
			lines := strings.Split(out, "\n")
			for _, line := range lines {
				fields := strings.Fields(line)
				if len(fields) < 3 {
					continue
				}
				if fields[0] == "-" || fields[1] == "-" {
					return 0, 0, true
				}
				added, addErr := strconv.Atoi(fields[0])
				removed, removeErr := strconv.Atoi(fields[1])
				if addErr == nil && removeErr == nil {
					return added, removed, false
				}
			}
		}
	}
	switch status {
	case "untracked", "added":
		return countLines(modifiedBytes), 0, false
	case "deleted":
		return 0, countLines(originalBytes), false
	default:
		origLines := countLines(originalBytes)
		modLines := countLines(modifiedBytes)
		if modLines >= origLines {
			return modLines - origLines, 0, false
		}
		return 0, origLines - modLines, false
	}
}

func normalizeRepoPath(repoRoot, repoPath string) string {
	if repoPath == "" {
		return ""
	}
	if !filepath.IsAbs(repoPath) {
		return filepath.ToSlash(repoPath)
	}
	relPath, err := filepath.Rel(repoRoot, repoPath)
	if err == nil && relPath != "." && !strings.HasPrefix(relPath, "..") {
		return filepath.ToSlash(relPath)
	}
	return repoPath
}

func countLines(data []byte) int {
	if len(data) == 0 {
		return 0
	}
	count := bytes.Count(data, []byte{'\n'})
	if data[len(data)-1] != '\n' {
		count++
	}
	return count
}

func isLikelyBinary(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	sample := data
	if len(sample) > 8000 {
		sample = sample[:8000]
	}
	if bytes.IndexByte(sample, 0) >= 0 {
		return true
	}
	return !utf8.Valid(sample)
}

func runGitTrim(ctx context.Context, workingDir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", workingDir}, args...)...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		errText := strings.TrimSpace(stderr.String())
		if errText == "" {
			errText = err.Error()
		}
		return "", fmt.Errorf("git %s failed: %s", strings.Join(args, " "), errText)
	}
	return strings.TrimSpace(stdout.String()), nil
}
