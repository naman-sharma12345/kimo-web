'use client';
import * as React from 'react';
import { Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import {
  AttachmentChip,
  Avatar,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
  Kbd,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Panel,
  Pill,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Row,
  ScrollArea,
  Section,
  Segmented,
  SegmentedItem,
  Skeleton,
  Slider,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toast,
  ToastProvider,
  Toggle,
  Tooltip,
  useToast,
} from '@/components/ui';
import '@/styles/ui.css';
const buttonVariants = ['primary', 'secondary', 'ghost', 'danger'] as const;
const buttonSizes = ['xs', 'sm', 'md', 'lg'] as const;
function ToastActions() {
  const { notify } = useToast();
  return (
    <div className="ui-demo-line">
      {(['info', 'success', 'error'] as const).map((tone) => (
        <Button
          key={tone}
          onClick={() =>
            notify({
              message:
                tone === 'error'
                  ? 'Upload failed'
                  : tone === 'success'
                    ? 'Upload complete'
                    : 'Changes saved',
              tone,
              action: {
                label: 'Undo',
                onClick: () => notify({ message: 'Change undone' }),
              },
            })
          }
        >
          {tone} toast
        </Button>
      ))}
    </div>
  );
}
function Gallery() {
  const [paused, setPaused] = React.useState(false);
  const [attachment, setAttachment] = React.useState(true);
  const [tab, setTab] = React.useState('video');
  const [checked, setChecked] = React.useState(true);
  const [quality, setQuality] = React.useState('original');
  const [slider, setSlider] = React.useState([50]);
  return (
    <main
      className="ui-demo"
      data-ready="true"
      data-paused={paused || undefined}
    >
      <a href="#ui-components" className="ui-demo-skip">
        Skip to components
      </a>
      <h1>kimo UI</h1>
      <p>
        Phase 1 component gallery. Use Tab, Enter, Space, Escape and arrow keys.
        Forced hover and focus examples use data-state. Open menus and dialogs
        to inspect their interactive states.
      </p>
      <div className="ui-demo-line ui-demo-motion-controls">
        <Toggle
          id="pause-ui-loops"
          aria-label="Pause looping animations"
          checked={paused}
          onCheckedChange={setPaused}
        />
        <label htmlFor="pause-ui-loops">Pause looping animations</label>
      </div>
      <Section label="Buttons" id="ui-components" tabIndex={-1}>
        <div className="ui-demo-grid">
          {buttonVariants.flatMap((variant) =>
            buttonSizes.map((size) => (
              <Panel key={`${variant}-${size}`} title={`${variant} / ${size}`}>
                <Button variant={variant} size={size}>
                  <Plus aria-hidden="true" />
                  {variant === 'primary'
                    ? 'send'
                    : variant === 'danger'
                      ? 'delete'
                      : 'Add clip'}
                </Button>
              </Panel>
            )),
          )}
          {buttonVariants.flatMap((variant) =>
            (['hover', 'focus', 'pressed', 'disabled', 'loading'] as const).map(
              (state) => (
                <Panel
                  key={`${variant}-${state}`}
                  title={`${variant} / ${state}`}
                >
                  <Button
                    variant={variant}
                    data-state={state}
                    disabled={state === 'disabled'}
                    loading={state === 'loading'}
                  >
                    {variant === 'primary' ? 'send' : 'Add clip'}
                  </Button>
                </Panel>
              ),
            ),
          )}
          {buttonSizes.map((size) => (
            <Panel key={`icon-${size}`} title={`Icon only / ${size}`}>
              <Button
                size={size}
                variant="ghost"
                iconOnly
                aria-label="Add clip"
                tooltip="Add clip"
              >
                <Plus aria-hidden="true" />
              </Button>
            </Panel>
          ))}
        </div>
      </Section>
      <div className="ui-demo-grid">
        <Panel title="Input and textarea">
          <div className="ui-demo-stack">
            {(['default', 'hover', 'focus', 'disabled', 'error'] as const).map(
              (state) => (
                <label key={state} className="ui-demo-stack">
                  Input / {state}
                  <Input
                    placeholder="Name your project"
                    data-state={state}
                    disabled={state === 'disabled'}
                    error={
                      state === 'error' ? 'Project name is required' : undefined
                    }
                  />
                </label>
              ),
            )}
            {(['default', 'hover', 'focus', 'disabled', 'error'] as const).map(
              (state) => (
                <label key={state} className="ui-demo-stack">
                  Textarea / {state}
                  <Textarea
                    maxRows={4}
                    placeholder="Describe your video"
                    data-state={state}
                    disabled={state === 'disabled'}
                    error={
                      state === 'error' ? 'Description is required' : undefined
                    }
                  />
                </label>
              ),
            )}
          </div>
        </Panel>
        <Panel title="Attachments">
          <div className="ui-demo-stack">
            {(['video', 'image', 'audio', 'doc'] as const).map((kind) => (
              <AttachmentChip
                key={kind}
                kind={kind}
                name={
                  kind === 'doc' ? 'Project brief.pdf' : `${kind} attachment`
                }
                meta="0:12 · 24 MB"
                onRemove={() => undefined}
              />
            ))}
            <AttachmentChip
              kind="video"
              name="Uploading video"
              meta="0:12 · 24 MB"
              progress={48}
            />
            <AttachmentChip
              kind="image"
              name="Upload complete"
              meta="24 MB"
              progress={100}
            />
            {attachment ? (
              <AttachmentChip
                kind="doc"
                name="Removable brief.pdf"
                meta="24 MB"
                onRemove={() => setAttachment(false)}
              />
            ) : (
              <Button onClick={() => setAttachment(true)}>
                Restore attachment
              </Button>
            )}
          </div>
        </Panel>
        <Panel title="Status">
          <div className="ui-demo-line">
            <Pill>Draft</Pill>
            <Avatar identity="user" name="gaurav" />
            <Avatar identity="user" />
            <Kbd>⌘ K</Kbd>
            <Spinner label="Loading" />
            <Spinner size={20} label="Loading preview" />
          </div>
        </Panel>
        <Panel title="Live / idle">
          <Pill variant="live">live</Pill>
        </Panel>
        <Panel title="Live / active">
          <Pill variant="live" active>
            live
          </Pill>
        </Panel>
        <Panel title="Agent / idle">
          <Avatar />
        </Panel>
        <Panel title="Agent / acting">
          <Avatar active />
        </Panel>
        <Panel title="Tooltip">
          <div className="ui-demo-line">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <Tooltip key={side} content="Add clip" shortcut="⌘ K" side={side}>
                <Button>{side}</Button>
              </Tooltip>
            ))}
          </div>
        </Panel>
        <Panel title="Menu">
          <Menu>
            <MenuTrigger asChild>
              <Button>
                <MoreHorizontal aria-hidden="true" />
                Project actions
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Project</MenuLabel>
              <MenuItem icon={<Copy />} shortcut="⌘ C">
                Duplicate
              </MenuItem>
              <MenuItem disabled>Unavailable action</MenuItem>
              <MenuCheckboxItem
                checked={checked}
                onCheckedChange={(next) => setChecked(next === true)}
              >
                Show guides
              </MenuCheckboxItem>
              <MenuSeparator />
              <MenuRadioGroup value={quality} onValueChange={setQuality}>
                <MenuRadioItem value="original">Original</MenuRadioItem>
                <MenuRadioItem value="proxy">Proxy</MenuRadioItem>
              </MenuRadioGroup>
              <MenuSub>
                <MenuSubTrigger>More actions</MenuSubTrigger>
                <MenuSubContent>
                  <MenuItem>Archive</MenuItem>
                </MenuSubContent>
              </MenuSub>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />}>Delete</MenuItem>
            </MenuContent>
          </Menu>
        </Panel>
        <Panel title="Popover">
          <Popover>
            <PopoverTrigger asChild>
              <Button>Project details</Button>
            </PopoverTrigger>
            <PopoverContent
              className="ui-demo-popover"
              aria-label="Project details"
            >
              <div className="ui-demo-stack">
                <p>Project settings</p>
                <label htmlFor="popover-project-name">
                  Project name
                  <Input
                    id="popover-project-name"
                    defaultValue="Untitled project"
                  />
                </label>
                <PopoverClose asChild>
                  <Button>Close</Button>
                </PopoverClose>
              </div>
            </PopoverContent>
          </Popover>
        </Panel>
        <Panel title="Context menu">
          <ContextMenu>
            <ContextMenuTrigger
              className="ui-demo-context"
              tabIndex={0}
              aria-label="Clip actions"
            >
              Right-click, Context Menu key or Shift+F10
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem icon={<Copy />} shortcut="⌘ C">
                Duplicate
              </ContextMenuItem>
              <ContextMenuItem disabled>Unavailable action</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem>Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </Panel>
        <Panel title="Dialog">
          <div className="ui-demo-line">
            {(['sm', 'md'] as const).map((size) => (
              <Dialog key={size}>
                <DialogTrigger asChild>
                  <Button>Open {size} dialog</Button>
                </DialogTrigger>
                <DialogContent size={size}>
                  <DialogTitle>Discard changes?</DialogTitle>
                  <DialogDescription>
                    Your unsaved changes will be lost.
                  </DialogDescription>
                  <DialogActions>
                    <DialogClose asChild>
                      <Button>Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="danger">Discard</Button>
                    </DialogClose>
                  </DialogActions>
                </DialogContent>
              </Dialog>
            ))}
          </div>
        </Panel>
        <Panel title="Toasts">
          <div className="ui-demo-stack">
            <Toast message="Changes saved" paused />
            <Toast
              message="Upload complete"
              tone="success"
              paused
              action={{ label: 'Undo', onClick: () => undefined }}
            />
            <Toast message="Upload failed" tone="error" paused />
            <ToastActions />
          </div>
        </Panel>
        <Panel title="Progress">
          <div className="ui-demo-stack">
            <Progress aria-label="Upload" value={32} />
            <Progress aria-label="Thin upload" value={72} thin />
            <Progress aria-label="Preparing upload" />
            <Progress aria-label="Empty upload" value={0} />
            <Progress aria-label="Completed upload" value={100} />
          </div>
        </Panel>
        <Panel title="Progress / running">
          <Progress aria-label="Agent working" value={50} running />
        </Panel>
        <Panel title="Progress / running indeterminate">
          <Progress aria-label="Agent preparing" running />
        </Panel>
        <Panel title="Skeleton">
          <div className="ui-demo-line">
            {(['4', '6', '8', '12', '20', 'pill'] as const).map((radius) => (
              <div className="ui-demo-stack" key={radius}>
                <span>Radius {radius}</span>
                <Skeleton radius={radius} className="ui-demo-skeleton" />
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Segmented control">
          <div className="ui-demo-stack">
            <Segmented defaultValue="video" aria-label="Media type">
              <SegmentedItem value="video">Video</SegmentedItem>
              <SegmentedItem value="audio">Audio</SegmentedItem>
              <SegmentedItem value="image">Image</SegmentedItem>
              <SegmentedItem value="disabled" disabled>
                Unavailable
              </SegmentedItem>
            </Segmented>
            <Segmented
              defaultValue="video"
              disabled
              aria-label="Disabled media type"
            >
              <SegmentedItem value="video">Video</SegmentedItem>
              <SegmentedItem value="audio">Audio</SegmentedItem>
            </Segmented>
          </div>
        </Panel>
        <Panel title="Toggle">
          <div className="ui-demo-line">
            <Toggle aria-label="Enable guides" />
            <Toggle defaultChecked aria-label="Enable snapping" />
            <Toggle disabled aria-label="Disabled off" />
            <Toggle disabled defaultChecked aria-label="Disabled on" />
          </div>
        </Panel>
        <Panel title="Slider">
          <div className="ui-demo-stack">
            <label htmlFor="slider-value">Volume</label>
            <div className="ui-demo-line">
              <div className="ui-demo-spacer">
                <Slider
                  aria-label="Volume"
                  value={slider}
                  onValueChange={setSlider}
                />
              </div>
              <Input
                id="slider-value"
                aria-label="Volume value"
                type="number"
                min={0}
                max={100}
                value={slider[0]}
                onChange={(event) =>
                  setSlider([
                    Math.max(
                      0,
                      Math.min(100, event.currentTarget.valueAsNumber || 0),
                    ),
                  ])
                }
              />
            </div>
            <Slider aria-label="Disabled volume" defaultValue={[25]} disabled />
            <Slider aria-label="Trim range" defaultValue={[20, 80]} />
            <Slider
              aria-label="Vertical volume"
              orientation="vertical"
              defaultValue={[50]}
            />
          </div>
        </Panel>
        <Panel title="Tabs">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Inspector tabs">
              <TabsTrigger value="video">Video</TabsTrigger>
              <TabsTrigger value="audio">Audio</TabsTrigger>
              <TabsTrigger value="disabled" disabled>
                Unavailable
              </TabsTrigger>
            </TabsList>
            <TabsContent value="video">Video settings</TabsContent>
            <TabsContent value="audio">Audio settings</TabsContent>
          </Tabs>
        </Panel>
        <Panel
          title="Panel, section and row"
          actions={
            <Button
              variant="ghost"
              iconOnly
              aria-label="Panel options"
              tooltip="Panel options"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          }
        >
          <Section label="Transform" collapsible>
            <Row label="Position" value="0, 0" />
            <Row label="Scale" value="100%" dense />
            <Row label="Forced hover" value="100%" data-state="hover" />
          </Section>
          <Section label="Audio" collapsible defaultOpen={false}>
            <Row label="Volume" value="100%" />
          </Section>
        </Panel>
        <Panel title="Flush panel" flush>
          <Row label="Duration" value="0:12" />
        </Panel>
        <Panel title="Scroll area">
          <ScrollArea
            className="ui-demo-scroll"
            viewportProps={{ 'aria-label': 'Project clips' }}
          >
            {Array.from({ length: 20 }, (_, index) => (
              <Row key={index} label={`Clip ${index + 1}`} value="0:12" />
            ))}
          </ScrollArea>
        </Panel>
      </div>
    </main>
  );
}
export default function UIPage() {
  return (
    <ToastProvider>
      <Gallery />
    </ToastProvider>
  );
}
