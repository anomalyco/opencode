// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

//go:build ios

#import <UIKit/UIKit.h>
#import <MobileCoreServices/MobileCoreServices.h>

void clipboard_write_string(char *s) {
    NSString *value = [NSString stringWithUTF8String:s];
    [[UIPasteboard generalPasteboard] setString:value];
}

char *clipboard_read_string() {
    NSString *str = [[UIPasteboard generalPasteboard] string];
    return (char *)[str UTF8String];
}
