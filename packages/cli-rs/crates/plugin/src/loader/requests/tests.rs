use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

use super::*;
use crate::loader::tests::{TestHost, dynamic, host};

/// An instance that counts the requests the host cancelled for it, and the replies it got, on `host`.
#[derive(Default)]
struct Cancelled {
    cancels: Cell<usize>,
    replies: RefCell<Vec<String>>,
    host: Option<Weak<dyn Host>>,
}

impl Cancelled {
    fn on(host: &Rc<TestHost>) -> Rc<Self> {
        Rc::new(Self { host: Some(Rc::downgrade(&dynamic(host))), ..Self::default() })
    }
}

impl Answers for Cancelled {
    fn live(&self) -> bool {
        true
    }

    fn running(&self) -> bool {
        true
    }

    fn owner(&self) -> Weak<dyn Host> {
        self.host.clone().unwrap_or_else(|| Weak::<TestHost>::new())
    }

    fn answer(self: Rc<Self>, request: Request) {
        if let Request::Reply { result, .. } = request {
            self.replies.borrow_mut().push(format!("{result:?}"));
        }
    }

    fn cancel(self: Rc<Self>, _: abi::RequestId) {
        self.cancels.set(self.cancels.get() + 1);
    }

    fn cancels(&self) -> bool {
        true
    }
}

#[test]
fn a_mounts_close_cancels_only_its_own_requests() {
    let host = host();
    let counted = Cancelled::on(&host);
    let guest = Rc::downgrade(&(counted.clone() as Rc<dyn Answers>));
    let (busy, closing) = (Rc::new(()), Rc::new(()));
    assert!((1..=1000).all(|id| wait(&Rc::downgrade(&busy), &guest, abi::RequestId(id))));
    assert!((1001..=1002).all(|id| wait(&Rc::downgrade(&closing), &guest, abi::RequestId(id))));
    let key = mount_key(&Rc::downgrade(&closing));
    drop(closing);
    assert_eq!(cancel_closed(key), 2, "the close looked at another mount's requests");
    host.app.advance(Duration::from_millis(1));
    assert_eq!((counted.cancels.get(), waiting()), (2, 1000));
    assert!((1..=1000).rev().all(|id| take_inflight(abi::RequestId(id))));
    assert!(!take_inflight(abi::RequestId(1001)), "a cancelled request waited still");
    assert_eq!(waiting(), 0);
}

#[test]
fn a_mounts_close_spreads_its_cancels_over_frames() {
    let host = host();
    let instances: Vec<_> = (0..3).map(|_| Cancelled::on(&host)).collect();
    let mount = Rc::new(());
    for (at, counted) in instances.iter().enumerate() {
        let guest = Rc::downgrade(&(counted.clone() as Rc<dyn Answers>));
        let first = 5000 + at as u64 * 1000;
        assert!((first..first + 1000).all(|id| wait(&Rc::downgrade(&mount), &guest, abi::RequestId(id))));
    }
    let key = mount_key(&Rc::downgrade(&mount));
    drop(mount);
    assert_eq!(cancel_closed(key), 3000);
    let told = || instances.iter().map(|counted| counted.cancels.get()).sum::<usize>();
    assert_eq!(told(), 0, "a cancel ran in the close's own call");
    host.app.advance(Duration::from_millis(1));
    assert_eq!(told(), 1024, "the cancels of one close ran past a frame's effects");
    for _ in 0..3 {
        host.app.render();
        host.app.advance(Duration::from_millis(1));
    }
    assert_eq!((told(), waiting()), (3000, 0));
}

#[test]
fn a_mount_request_past_the_cap_is_refused_with_its_reply() {
    let host = host();
    let counted = Cancelled::on(&host);
    let guest = Rc::downgrade(&(counted.clone() as Rc<dyn Answers>));
    let mount = Rc::new(());
    let sent = Rc::new(Cell::new(0));
    let ask = |id: u64| {
        let sent = sent.clone();
        let owned = Some(Rc::downgrade(&mount));
        reply_to(&guest, &*dynamic(&host), abi::RequestId(id), owned, move |_, _| sent.set(sent.get() + 1));
    };
    (1..=MOUNT_REQUESTS as u64 + 1).for_each(ask);
    assert_eq!(sent.get(), MOUNT_REQUESTS);
    assert_eq!(*counted.replies.borrow(), ["Err(\"more than 1024 requests of the plugin's mounts wait\")"]);
    assert!(take_inflight(abi::RequestId(1)));
    ask(9000);
    assert_eq!((sent.get(), counted.replies.borrow().len()), (MOUNT_REQUESTS + 1, 1));
    let key = mount_key(&Rc::downgrade(&mount));
    drop(mount);
    assert_eq!(cancel_closed(key), MOUNT_REQUESTS);
}
