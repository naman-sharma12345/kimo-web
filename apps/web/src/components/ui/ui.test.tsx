import * as React from 'react';
import { readFileSync } from 'node:fs';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AttachmentChip,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Progress,
  ScrollArea,
  Section,
  Segmented,
  SegmentedItem,
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toast,
  ToastProvider,
  Toggle,
  useToast,
} from './index';
const browserMethods = [
  'scrollIntoView',
  'hasPointerCapture',
  'setPointerCapture',
  'releasePointerCapture',
] as const;
const originalMethods = browserMethods.map((name) =>
  Object.getOwnPropertyDescriptor(Element.prototype, name),
);
beforeAll(() => {
  class PointerEventMock extends MouseEvent {
    pointerId = 1;
    pointerType = 'mouse';
  }
  vi.stubGlobal('PointerEvent', PointerEventMock);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  browserMethods.forEach((name) =>
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      value: vi.fn(() => (name === 'hasPointerCapture' ? false : undefined)),
    }),
  );
});
afterAll(() => {
  browserMethods.forEach((name, index) => {
    const descriptor = originalMethods[index];
    if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
    else Reflect.deleteProperty(Element.prototype, name);
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Phase 1 keyboard contracts', () => {
  it('tabs to a button and activates with Enter and Space', async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    render(<Button onClick={click}>Add clip</Button>);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter} ');
    expect(click).toHaveBeenCalledTimes(2);
  });
  it('skips disabled and loading buttons while retaining their labels', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button disabled>Disabled</Button>
        <Button loading>Saving</Button>
        <Button>Ready</Button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Ready' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Saving' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });
  it('names icon-only buttons and opens their tooltip on focus', async () => {
    const user = userEvent.setup();
    render(
      <Button iconOnly aria-label="Add clip" tooltip="Add clip">
        +
      </Button>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add clip' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add clip');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(),
    );
  });
  it('links field errors and preserves caller descriptions', async () => {
    const user = userEvent.setup();
    render(
      <>
        <p id="hint">Required field</p>
        <Input
          aria-label="Name"
          aria-describedby="hint"
          error="Name is required"
        />
        <Textarea
          aria-label="Description"
          error="Describe the video"
          maxRows={3}
        />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAccessibleDescription(
      'Required field Name is required',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByRole('textbox', { name: 'Description' }),
    ).toHaveAccessibleDescription('Describe the video');
    await user.tab();
    await user.type(input, 'Project');
    expect(input).toHaveValue('Project');
  });
  it('exposes a removable attachment as a named keyboard action', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    render(
      <AttachmentChip
        name="brief.pdf"
        meta="24 MB"
        kind="doc"
        onRemove={remove}
      />,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    expect(remove).toHaveBeenCalledOnce();
  });
  it('toggles a native switch with Space and Enter', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<Toggle aria-label="Snapping" onCheckedChange={change} />);
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Enter}');
    expect(change).toHaveBeenLastCalledWith(false);
  });
  it('keeps controlled switch state with its owner', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<Toggle aria-label="Snapping" checked onCheckedChange={change} />);
    await user.tab();
    await user.keyboard(' ');
    expect(change).toHaveBeenCalledWith(false);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
  it('moves segmented focus with arrows, skips disabled and selects with Space', async () => {
    const user = userEvent.setup();
    render(
      <Segmented defaultValue="video" aria-label="Media">
        <SegmentedItem value="video">Video</SegmentedItem>
        <SegmentedItem value="disabled" disabled>
          Disabled
        </SegmentedItem>
        <SegmentedItem value="audio">Audio</SegmentedItem>
      </Segmented>,
    );
    await user.tab();
    await user.keyboard('{ArrowRight} ');
    expect(screen.getByRole('radio', { name: 'Audio' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
  it('changes tabs with arrows and associates the panel', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="video">
        <TabsList aria-label="Inspector">
          <TabsTrigger value="video">Video</TabsTrigger>
          <TabsTrigger value="audio">Audio</TabsTrigger>
        </TabsList>
        <TabsContent value="video">Video settings</TabsContent>
        <TabsContent value="audio">Audio settings</TabsContent>
      </Tabs>,
    );
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Audio' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Audio');
  });
  it('supports manual tab activation with Enter', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="one" activationMode="manual">
        <TabsList aria-label="Manual">
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First</TabsContent>
        <TabsContent value="two">Second</TabsContent>
      </Tabs>,
    );
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
  it('updates slider with arrows, Home and End', async () => {
    const user = userEvent.setup();
    render(<Slider aria-label="Volume" defaultValue={[50]} />);
    await user.tab();
    const slider = screen.getByRole('slider');
    await user.keyboard('{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '51');
    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '100');
  });
  it('defaults a slider to its supplied minimum', () => {
    render(<Slider aria-label="Playback rate" min={25} max={200} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '25');
  });
  it('opens a menu with Enter, navigates with arrows and dismisses with Escape', async () => {
    const user = userEvent.setup();
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>Actions</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem>Duplicate</MenuItem>
          <MenuItem disabled>Disabled</MenuItem>
          <MenuItem>Archive</MenuItem>
        </MenuContent>
      </Menu>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    const first = await screen.findByRole('menuitem', { name: 'Duplicate' });
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus();
  });
  it('selects a menu item with Enter', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>Actions</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={select}>Duplicate</MenuItem>
        </MenuContent>
      </Menu>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{Enter}');
    expect(select).toHaveBeenCalledOnce();
  });
  it('opens a context menu from Shift+F10', async () => {
    const user = userEvent.setup();
    render(
      <ContextMenu>
        <ContextMenuTrigger>Clip</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Duplicate</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    await user.tab();
    expect(screen.getByText('Clip')).toHaveFocus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
  });
  it('respects explicit context trigger tab order and disabled keyboard behavior', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ContextMenu>
          <ContextMenuTrigger tabIndex={-1}>Excluded clip</ContextMenuTrigger>
        </ContextMenu>
        <ContextMenu>
          <ContextMenuTrigger disabled>Disabled clip</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Duplicate</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <Button>Next</Button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    expect(screen.getByText('Excluded clip')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Disabled clip')).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(screen.getByText('Disabled clip'), {
      key: 'F10',
      shiftKey: true,
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
  it('preserves an asChild context trigger native focus and explicit child tab order', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button" tabIndex={-1}>
              Excluded child
            </button>
          </ContextMenuTrigger>
        </ContextMenu>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button">Native child</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Duplicate</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </>,
    );
    expect(
      screen.getByRole('button', { name: 'Excluded child' }),
    ).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Native child' })).toHaveFocus();
    await user.keyboard('{ContextMenu}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
  it('traps dialog focus and restores it after Escape', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Discard changes?</DialogTitle>
          <DialogDescription>Changes will be lost.</DialogDescription>
          <DialogActions>
            <Button>Keep editing</Button>
            <DialogClose asChild>
              <Button>Close</Button>
            </DialogClose>
          </DialogActions>
        </DialogContent>
      </Dialog>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Discard changes?');
    expect(dialog).toHaveAccessibleDescription('Changes will be lost.');
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(buttons[1]).toHaveFocus();
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });
  it('dismisses a popover with Escape and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Details</Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Details">
          <PopoverClose asChild>
            <Button>Close details</Button>
          </PopoverClose>
        </PopoverContent>
      </Popover>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('dialog', { name: 'Details' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus();
  });
  it('collapses sections with Space and expands with Enter', async () => {
    const user = userEvent.setup();
    render(
      <Section label="Transform" collapsible>
        <p>Position controls</p>
      </Section>,
    );
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Position controls')).not.toBeVisible();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Position controls')).toBeVisible();
  });
  it('provides a keyboard-focusable scroll viewport', async () => {
    const user = userEvent.setup();
    render(
      <ScrollArea viewportProps={{ 'aria-label': 'Clips' }}>Clips</ScrollArea>,
    );
    await user.tab();
    expect(screen.getByLabelText('Clips')).toHaveFocus();
  });
  it('clamps progress and omits a false value for indeterminate progress', () => {
    render(
      <>
        <Progress aria-label="Upload" value={120} />
        <Progress aria-label="Preparing" />
      </>,
    );
    expect(screen.getByRole('progressbar', { name: 'Upload' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    expect(
      screen.getByRole('progressbar', { name: 'Preparing' }),
    ).not.toHaveAttribute('aria-valuenow');
  });
});

describe('Toast lifecycle', () => {
  it('dismisses info at 4s and error at 8s', () => {
    vi.useFakeTimers();
    try {
      const info = vi.fn();
      const error = vi.fn();
      render(
        <>
          <Toast message="Saved" onDismiss={info} />
          <Toast message="Failed" tone="error" onDismiss={error} />
        </>,
      );
      act(() => vi.advanceTimersByTime(4000));
      expect(info).toHaveBeenCalledOnce();
      expect(error).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(4000));
      expect(error).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it('pauses on hover and resumes the remaining time', () => {
    vi.useFakeTimers();
    try {
      const dismiss = vi.fn();
      render(<Toast message="Saved" onDismiss={dismiss} />);
      act(() => vi.advanceTimersByTime(2000));
      fireEvent.mouseEnter(screen.getByRole('status'));
      act(() => vi.advanceTimersByTime(8000));
      expect(dismiss).not.toHaveBeenCalled();
      fireEvent.mouseLeave(screen.getByRole('status'));
      act(() => vi.advanceTimersByTime(2000));
      expect(dismiss).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it('supports toast actions and focused Escape dismissal from the keyboard', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const dismiss = vi.fn();
    render(
      <Toast
        message="Saved"
        paused
        onDismiss={dismiss}
        action={{ label: 'Undo', onClick: action }}
      />,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    expect(action).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
    await user.keyboard('{Escape}');
    expect(dismiss).toHaveBeenCalledTimes(2);
  });
  it('retains at most three notifications', async () => {
    function Send() {
      const { notify } = useToast();
      return (
        <button
          onClick={() => {
            for (let index = 0; index < 4; index++)
              notify({ message: `Saved ${index}` });
          }}
        >
          Notify
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Send />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.queryByText('Saved 0')).not.toBeInTheDocument();
  });
});

// Source-level style contracts only; these do not claim rendered-browser verification.
describe('keyboard focus style contracts', () => {
  const css = readFileSync(
    `${process.cwd()}/apps/web/src/styles/ui.css`,
    'utf8',
  );
  it('keeps the slider keyboard focus ring after its resting ring', () => {
    const focusRule = '.ui-slider-thumb:focus-visible';
    expect(css.indexOf(focusRule)).toBeGreaterThan(
      css.indexOf('.ui-slider-thumb {'),
    );
    expect(css).toMatch(
      /\.ui-slider-thumb:focus-visible\s*\{\s*box-shadow:\s*var\(--focus-ring\);\s*\}/,
    );
  });
  it('limits menu focus rings to focus-visible, not pointer highlight', () => {
    const highlight = css.match(
      /\.ui-menu-item:is\(\[data-highlighted\], \[data-state='hover'\]\)\s*\{([^}]+)\}/,
    );
    expect(highlight).not.toBeNull();
    expect(highlight?.[1]).toContain('background: var(--ink-3)');
    expect(highlight?.[1]).not.toContain('box-shadow');
    expect(css).toMatch(
      /\.ui-menu-item:focus-visible\s*\{\s*box-shadow:\s*var\(--focus-ring\);\s*\}/,
    );
  });
});
