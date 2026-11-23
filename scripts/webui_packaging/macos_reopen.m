#import <AppKit/AppKit.h>

@interface MuseFrameReopenDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSURL *workbenchURL;
@end

@implementation MuseFrameReopenDelegate
- (BOOL)applicationShouldHandleReopen:(NSApplication *)application hasVisibleWindows:(BOOL)visible {
    [NSWorkspace.sharedWorkspace openURL:self.workbenchURL];
    return NO;
}
@end

// NSApplication holds its delegate weakly.
static MuseFrameReopenDelegate *reopenDelegate;

void muse_frame_enable_reopen(const char *workbenchURL) {
    @autoreleasepool {
        NSApplication *application = NSApplication.sharedApplication;
        reopenDelegate = [MuseFrameReopenDelegate new];
        reopenDelegate.workbenchURL = [NSURL URLWithString:[NSString stringWithUTF8String:workbenchURL]];
        application.delegate = reopenDelegate;
        [application finishLaunching];
    }
}

void muse_frame_process_app_events(void) {
    @autoreleasepool {
        NSApplication *application = NSApp;
        NSEvent *event;
        while ((event = [application nextEventMatchingMask:NSEventMaskAny
                                                 untilDate:NSDate.distantPast
                                                    inMode:NSDefaultRunLoopMode
                                                   dequeue:YES])) {
            [application sendEvent:event];
        }
    }
}
